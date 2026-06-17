import asyncHandler from 'express-async-handler';
import Stripe from 'stripe';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import User from '../models/User.js';
import { sendCustomerOrderWhatsAppNotification, sendNewOrderWhatsAppNotification } from '../utils/whatsapp.js';
import { ensureStoreSettings } from '../utils/storeSettings.js';
import { calculateOrderPricing, incrementDiscountCodeUsage } from '../utils/pricing.js';

const normalizeProvider = (provider = '') => String(provider || '').trim().toLowerCase();

const resolveClientUrl = (req) => process.env.CLIENT_URL || req.headers.origin || 'http://localhost:5173';

const getStripeClient = async () => {
  const settings = await ensureStoreSettings();
  const secretKey = settings.payment?.stripeSecretKey || process.env.STRIPE_SECRET_KEY;

  if (!settings.payment?.onlinePaymentEnabled) {
    const error = new Error('الدفع الأونلاين غير مفعل حاليًا');
    error.statusCode = 400;
    throw error;
  }

  if (!secretKey) {
    const error = new Error('مفتاح Stripe السري غير موجود في الإعدادات');
    error.statusCode = 400;
    throw error;
  }

  return {
    stripe: new Stripe(secretKey),
    settings
  };
};

const getGatewaySettings = async () => {
  const settings = await ensureStoreSettings();
  const paymentSettings = settings.payment || {};

  if (!paymentSettings.onlinePaymentEnabled) {
    const error = new Error('الدفع الأونلاين غير مفعل حاليًا');
    error.statusCode = 400;
    throw error;
  }

  return { settings, paymentSettings };
};

const buildOrderItems = async (orderItems) => {
  const ids = orderItems.map((item) => item.product);
  const products = await Product.find({ _id: { $in: ids } });

  return orderItems.map((item) => {
    const product = products.find((entry) => entry._id.toString() === item.product);
    if (!product) throw new Error('منتج غير موجود');
    if (product.countInStock < item.qty) throw new Error(`الكمية غير متاحة: ${product.name}`);

    return {
      product: product._id,
      name: product.name,
      qty: item.qty,
      image: product.image?.url,
      price: product.price
    };
  });
};

const consumeLoyaltyPoints = async (userId, order, usedPoints) => {
  if (!Number(usedPoints || 0)) return;

  const user = await User.findById(userId);
  if (!user) return;

  user.loyaltyPoints = Math.max(0, Number(user.loyaltyPoints || 0) - Number(usedPoints || 0));
  user.loyaltyHistory = [
    {
      amount: -Number(usedPoints || 0),
      reason: 'استخدام نقاط في طلب مدفوع أونلاين',
      order: order._id
    },
    ...(Array.isArray(user.loyaltyHistory) ? user.loyaltyHistory : [])
  ].slice(0, 30);
  await user.save();
};

const buildCheckoutPayload = ({
  req,
  shippingAddress,
  items,
  pricing,
  settings
}) => JSON.stringify({
  userId: req.user._id.toString(),
  clientUrl: resolveClientUrl(req),
  shippingAddress,
  items,
  discountCode: pricing.discountCode,
  discountCodeSource: pricing.discountCodeSource,
  discountCodeAmount: pricing.discountCodeAmount,
  loyaltyPointsUsed: pricing.loyaltyPointsUsed,
  loyaltyPointsDiscount: pricing.loyaltyPointsDiscount,
  itemsPrice: pricing.itemsPrice,
  shippingPrice: pricing.shippingPrice,
  totalPrice: pricing.totalPrice,
  provider: normalizeProvider(settings.payment?.onlineProvider || 'stripe')
});

const createStripeCheckout = async ({ req, pricing, settings, payload }) => {
  const { stripe } = await getStripeClient();
  const origin = resolveClientUrl(req);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    success_url: `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/checkout/review?cancelled=1`,
    customer_email: req.user.email,
    metadata: {
      checkoutPayload: payload
    },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: settings.payment?.currency || 'egp',
        unit_amount: Math.round(pricing.totalPrice * 100),
        product_data: {
          name: 'إجمالي الطلب بعد الخصومات'
        }
      }
    }]
  });

  return {
    url: session.url,
    sessionId: session.id,
    provider: 'stripe'
  };
};

const createHostedGatewayCheckout = async ({ req, pricing, settings, payload }) => {
  const paymentSettings = settings.payment || {};

  if (!paymentSettings.gatewayMerchantId || !paymentSettings.gatewayApiUsername || !paymentSettings.gatewayApiPassword || !paymentSettings.gatewayBaseUrl) {
    const error = new Error('تم اختيار بوابة البنك لكن بيانات الربط غير مكتملة بعد في إعدادات الدفع');
    error.statusCode = 400;
    throw error;
  }

  const reference = `gw_${Date.now()}`;
  const encodedPayload = Buffer.from(payload, 'utf8').toString('base64url');
  const successUrl = `${resolveClientUrl(req)}/checkout/success?gateway_ref=${encodeURIComponent(reference)}&provider=${encodeURIComponent(normalizeProvider(paymentSettings.onlineProvider))}&payload=${encodeURIComponent(encodedPayload)}`;

  return {
    url: successUrl,
    sessionId: reference,
    provider: normalizeProvider(paymentSettings.onlineProvider),
    integrationMode: paymentSettings.gatewayIntegrationMode || 'hosted_checkout',
    pendingGatewaySetup: true
  };
};

const notifyOrderCreation = async ({ order, user, shippingAddress, clientUrl }) => {
  console.log('WhatsApp hook reached for gateway payment verification', {
    orderId: String(order._id || ''),
    customerId: String(user?._id || ''),
    paymentMethod: order.paymentMethod
  });

  const adminWhatsAppResult = await sendNewOrderWhatsAppNotification({
    order,
    customer: user,
    shippingAddress
  }).catch((error) => {
    console.error('WhatsApp notification error', {
      orderId: String(order._id || ''),
      message: error.message
    });
    return { sent: false, reason: 'threw', message: error.message };
  });

  console.log('WhatsApp admin notification attempt finished', {
    orderId: String(order._id || ''),
    result: JSON.stringify(adminWhatsAppResult, null, 2)
  });

  const customerWhatsAppResult = await sendCustomerOrderWhatsAppNotification({
    order,
    customer: user,
    shippingAddress,
    clientUrl
  }).catch((error) => {
    console.error('WhatsApp customer notification error', {
      orderId: String(order._id || ''),
      message: error.message
    });
    return { sent: false, reason: 'threw', message: error.message };
  });

  console.log('WhatsApp customer notification attempt finished', {
    orderId: String(order._id || ''),
    result: JSON.stringify(customerWhatsAppResult, null, 2)
  });
};

const finalizePaidOrder = async ({ payload, paymentSessionId, paymentReference, settings, req }) => {
  const refreshedItems = await buildOrderItems(
    payload.items.map((item) => ({
      product: item.product.toString(),
      qty: item.qty
    }))
  );

  const order = await Order.create({
    user: payload.userId,
    orderItems: refreshedItems,
    shippingAddress: payload.shippingAddress,
    paymentMethod: 'دفع أونلاين',
    paymentProvider: settings.payment?.onlineProvider || 'stripe',
    paymentSessionId,
    paymentReference,
    itemsPrice: payload.itemsPrice,
    shippingPrice: payload.shippingPrice,
    discountCode: payload.discountCode,
    discountCodeAmount: payload.discountCodeAmount,
    loyaltyPointsUsed: payload.loyaltyPointsUsed,
    loyaltyPointsDiscount: payload.loyaltyPointsDiscount,
    totalPrice: payload.totalPrice,
    isPaid: true,
    paidAt: new Date()
  });

  for (const item of refreshedItems) {
    await Product.updateOne({ _id: item.product }, { $inc: { countInStock: -item.qty } });
  }

  await consumeLoyaltyPoints(payload.userId, order, payload.loyaltyPointsUsed);

  if (payload.discountCode) {
    const freshUser = payload.discountCodeSource === 'private' ? await User.findById(payload.userId) : null;
    await incrementDiscountCodeUsage({
      settings,
      user: freshUser,
      code: payload.discountCode,
      source: payload.discountCodeSource
    });
  }

  const customer = await User.findById(payload.userId).select('name phone email');
  await notifyOrderCreation({
    order,
    user: customer,
    shippingAddress: payload.shippingAddress,
    clientUrl: payload.clientUrl || resolveClientUrl(req)
  });

  return order;
};

export const createGatewayCheckoutSession = asyncHandler(async (req, res) => {
  const { orderItems, shippingAddress, discountCode, redeemLoyaltyPoints } = req.body;
  if (!orderItems?.length) {
    return res.status(400).json({ message: 'السلة فارغة' });
  }

  const items = await buildOrderItems(orderItems);
  const { settings, paymentSettings } = await getGatewaySettings();
  const pricing = await calculateOrderPricing({
    settings,
    items,
    shippingAddress,
    discountCode,
    redeemLoyaltyPoints,
    user: req.user
  });

  if (pricing.totalPrice <= 0) {
    return res.status(400).json({ message: 'إجمالي الطلب بعد الخصومات يساوي صفرًا، اختر الدفع عند الاستلام لإتمام الطلب' });
  }

  const payload = buildCheckoutPayload({ req, shippingAddress, items, pricing, settings });
  const provider = normalizeProvider(paymentSettings.onlineProvider || 'stripe');

  const session = provider === 'stripe'
    ? await createStripeCheckout({ req, pricing, settings, payload })
    : await createHostedGatewayCheckout({ req, pricing, settings, payload });

  res.json(session);
});

export const verifyGatewayCheckoutSession = asyncHandler(async (req, res) => {
  const reference = req.params.reference || req.params.sessionId;
  const providerParam = normalizeProvider(req.query.provider || '');
  const { settings, paymentSettings } = await getGatewaySettings();
  const provider = providerParam || normalizeProvider(paymentSettings.onlineProvider || 'stripe');

  if (provider === 'stripe') {
    const { stripe } = await getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(reference);

    if (session.payment_status !== 'paid') {
      return res.json({ paid: false, order: null });
    }

    let order = await Order.findOne({ paymentSessionId: session.id });

    if (!order) {
      const rawPayload = session.metadata?.checkoutPayload;
      if (!rawPayload) {
        return res.status(400).json({ message: 'بيانات الطلب غير موجودة داخل جلسة الدفع' });
      }

      const payload = JSON.parse(rawPayload);
      const isOwner = payload.userId === req.user._id.toString();

      if (!isOwner && req.user.role !== 'admin') {
        return res.status(403).json({ message: 'غير مصرح بهذه العملية' });
      }

      order = await finalizePaidOrder({
        payload,
        paymentSessionId: session.id,
        paymentReference: session.payment_intent?.toString() || session.id,
        settings,
        req
      });
    }

    const isOwner = order.user?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'غير مصرح بهذه العملية' });
    }

    if (!order.isPaid) {
      order.isPaid = true;
      order.paidAt = order.paidAt || new Date();
      order.paymentProvider = settings.payment?.onlineProvider || 'stripe';
      order.paymentSessionId = session.id;
      order.paymentReference = session.payment_intent?.toString() || session.id;
      await order.save();
    }

    return res.json({ paid: order.isPaid, order });
  }

  const rawPayload = req.query.payload ? Buffer.from(String(req.query.payload), 'base64url').toString('utf8') : '';
  if (!rawPayload) {
    return res.status(400).json({ message: 'لم تصل بيانات كافية للتحقق من عملية الدفع البنكية بعد' });
  }

  const payload = JSON.parse(rawPayload);
  const isOwner = payload.userId === req.user._id.toString();
  if (!isOwner && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'غير مصرح بهذه العملية' });
  }

  let order = await Order.findOne({ paymentSessionId: reference });
  if (!order) {
    order = await finalizePaidOrder({
      payload,
      paymentSessionId: reference,
      paymentReference: reference,
      settings,
      req
    });
  }

  return res.json({
    paid: order.isPaid,
    order,
    pendingGatewaySetup: true,
    message: 'تم تجهيز مسار التحقق العام. عند استلام مواصفات البنك النهائية سنستبدل هذا التحقق المؤقت بالتحقق المباشر مع البوابة.'
  });
});

export const createStripeCheckoutSession = createGatewayCheckoutSession;
export const verifyStripeCheckoutSession = verifyGatewayCheckoutSession;

import express from 'express';
import {
  createGatewayCheckoutSession,
  verifyGatewayCheckoutSession,
  createStripeCheckoutSession,
  verifyStripeCheckoutSession
} from '../controllers/paymentController.js';
import { protect } from '../middleware/auth.js';

const router = express.Router();

router.post('/gateway/checkout-session', protect, createGatewayCheckoutSession);
router.get('/gateway/verify/:reference', protect, verifyGatewayCheckoutSession);

router.post('/stripe/checkout-session', protect, createStripeCheckoutSession);
router.get('/stripe/verify/:sessionId', protect, verifyStripeCheckoutSession);

export default router;

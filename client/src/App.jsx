import React, { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import AppSplash from './components/AppSplash.jsx';
import Header from './components/Header.jsx';
import Footer from './components/Footer.jsx';
import SiteNotificationPrompt from './components/SiteNotificationPrompt.jsx';
import SupportChatWidget from './components/SupportChatWidget.jsx';
import { ensurePushSubscription } from './utils/pushNotifications.js';
import { useAuth } from './context/AuthContext.jsx';

import Home from './pages/Home.jsx';

const CategoriesPage = lazy(() => import('./pages/CategoriesPage.jsx'));
const CategoryPage = lazy(() => import('./pages/CategoryPage.jsx'));
const OffersPage = lazy(() => import('./pages/OffersPage.jsx'));
const WishlistPage = lazy(() => import('./pages/WishlistPage.jsx'));
const ProductDetails = lazy(() => import('./pages/ProductDetails.jsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const ContactPage = lazy(() => import('./pages/ContactPage.jsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.jsx'));
const PoliciesPage = lazy(() => import('./pages/PoliciesPage.jsx'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage.jsx'));
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'));
const ShippingPolicyPage = lazy(() => import('./pages/ShippingPolicyPage.jsx'));
const RefundPolicyPage = lazy(() => import('./pages/RefundPolicyPage.jsx'));
const AlWekalaProductsPage = lazy(() => import('./pages/AlWekalaProductsPage.jsx'));
const Cart = lazy(() => import('./pages/Cart.jsx'));
const Login = lazy(() => import('./pages/Login.jsx'));
const Register = lazy(() => import('./pages/Register.jsx'));
const CompletePasswordPage = lazy(() => import('./pages/CompletePasswordPage.jsx'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.jsx'));
const Checkout = lazy(() => import('./pages/Checkout.jsx'));
const CheckoutReview = lazy(() => import('./pages/CheckoutReview.jsx'));
const CheckoutSuccess = lazy(() => import('./pages/CheckoutSuccess.jsx'));
const Orders = lazy(() => import('./pages/Orders.jsx'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard.jsx'));
const StorePurchasesPage = lazy(() => import('./pages/StorePurchasesPage.jsx'));

function PrivateRoute({ children, adminOnly = false }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" />;
  const canAccessAdmin = user.role === 'admin' || (user.role === 'employee' && (user.permissions || []).length > 0);
  if (adminOnly && !canAccessAdmin) return <Navigate to="/" />;
  return children;
}

export default function App() {
  const location = useLocation();
  const { user } = useAuth();
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');
  const [bootSplashVisible, setBootSplashVisible] = useState(true);
  const [routeSplashVisible, setRouteSplashVisible] = useState(false);
  const firstPathRef = useRef(location.pathname);
  const requiresPasswordSetup = Boolean(user && !user.hasManualPassword);
  const prefersReducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isCompactViewport = typeof window !== 'undefined' && window.innerWidth <= 768;

  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => setBootSplashVisible(false), prefersReducedMotion || isCompactViewport ? 480 : 900);
    return () => window.clearTimeout(timer);
  }, [isCompactViewport, prefersReducedMotion]);

  useEffect(() => {
    if (firstPathRef.current === location.pathname) return;
    if (prefersReducedMotion || isCompactViewport) {
      setRouteSplashVisible(false);
      return undefined;
    }

    setRouteSplashVisible(true);
    const timer = window.setTimeout(() => setRouteSplashVisible(false), 180);
    return () => window.clearTimeout(timer);
  }, [isCompactViewport, location.pathname, prefersReducedMotion]);

  useEffect(() => {
    firstPathRef.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: prefersReducedMotion || isCompactViewport ? 'auto' : 'smooth' });
  }, [isCompactViewport, location.pathname, prefersReducedMotion]);

  useEffect(() => {
    if (!user || typeof window === 'undefined' || !('Notification' in window)) return;
    if (window.Notification.permission !== 'granted') return;
    ensurePushSubscription().catch(() => undefined);
  }, [user]);

  return <div className="app-root">
    <AppSplash visible={bootSplashVisible || routeSplashVisible} routeChanging={!bootSplashVisible && routeSplashVisible} />
    <Header
      theme={theme}
      onToggleTheme={() => setTheme(current => current === 'dark' ? 'light' : 'dark')}
    />
    <SiteNotificationPrompt />
    <main className={`app-main-shell${routeSplashVisible ? ' is-transitioning' : ''}`}>
      <Suspense fallback={<div className="route-content-fallback" aria-hidden="true" />}>
        <Routes>
        {requiresPasswordSetup
          ? <>
            <Route path="/complete-password" element={<CompletePasswordPage />} />
            <Route path="*" element={<Navigate to="/complete-password" replace />} />
          </>
          : <>
        <Route path="/" element={<Home />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/category/:name" element={<CategoryPage />} />
        <Route path="/offers" element={<OffersPage />} />
        <Route path="/alwekala-products" element={<AlWekalaProductsPage />} />
        <Route path="/wishlist" element={<WishlistPage />} />
        <Route path="/product/:id" element={<ProductDetails />} />
        <Route path="/profile" element={<PrivateRoute><ProfilePage /></PrivateRoute>} />
        <Route path="/settings" element={<PrivateRoute><SettingsPage /></PrivateRoute>} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/policies" element={<PoliciesPage />} />
        <Route path="/policies/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/policies/terms" element={<TermsPage />} />
        <Route path="/policies/shipping" element={<ShippingPolicyPage />} />
        <Route path="/policies/refund" element={<RefundPolicyPage />} />
        <Route path="/cart" element={<Cart />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/checkout" element={<PrivateRoute><Checkout /></PrivateRoute>} />
        <Route path="/checkout/review" element={<PrivateRoute><CheckoutReview /></PrivateRoute>} />
        <Route path="/checkout/success" element={<PrivateRoute><CheckoutSuccess /></PrivateRoute>} />
        <Route path="/orders" element={<PrivateRoute><Orders /></PrivateRoute>} />
        <Route path="/admin" element={<PrivateRoute adminOnly><AdminDashboard /></PrivateRoute>} />
        <Route path="/admin/store-purchases" element={<PrivateRoute adminOnly><StorePurchasesPage /></PrivateRoute>} />
          </>}
        </Routes>
      </Suspense>
    </main>
    <SupportChatWidget />
    <Footer />
  </div>;
}

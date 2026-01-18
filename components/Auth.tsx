
import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { ShieldCheck, Mail, Lock, ArrowRight, Loader2, AlertCircle } from 'lucide-react';

const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success', text: string } | null>(null);
  const [showIntro, setShowIntro] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 2500);
    return () => clearTimeout(timer);
  }, []);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      if (isSignUp) {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setMessage({ type: 'success', text: 'Signup successful! Please check your email to confirm.' });
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
      }
    } catch (error: any) {
      setMessage({ type: 'error', text: error.message || 'An error occurred' });
    } finally {
      setLoading(false);
    }
  };

  const getGreeting = () => {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const totalMinutes = hour * 60 + minute;

    // Morning: 6:00 AM (360 mins) to 11:57 AM (717 mins)
    if (totalMinutes >= 360 && totalMinutes <= 717) {
        return 'Good Morning';
    }

    // Afternoon: 12:00 PM (720 mins) to 4:00 PM (960 mins)
    if (totalMinutes >= 720 && totalMinutes <= 960) {
        return 'Good Afternoon';
    }

    // Evening: Rest of the time
    return 'Good Evening';
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 font-sans selection:bg-gold-500/30 selection:text-gold-200 relative overflow-hidden">
      
      {/* Intro Splash Screen */}
      <div className={`fixed inset-0 z-50 bg-slate-950 flex flex-col items-center justify-center transition-all duration-1000 ease-in-out ${showIntro ? 'opacity-100 visible' : 'opacity-0 invisible pointer-events-none'}`}>
          <div className="relative flex flex-col items-center w-full max-w-2xl px-4">
              {/* Background Glow */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-gold-500/10 blur-[100px] rounded-full animate-pulse-slow pointer-events-none"></div>
              
              <div className="relative z-10 flex flex-col items-center text-center">
                  <div className="w-24 h-24 bg-gradient-to-br from-gold-400 to-gold-600 rounded-3xl flex items-center justify-center shadow-glow mb-8 animate-[scaleIn_0.5s_ease-out]">
                      <ShieldCheck className="w-12 h-12 text-white" />
                  </div>
                  
                  <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-3 animate-[slideUp_0.5s_ease-out_0.2s_both]">
                      Welcome to <span className="text-gold-500">BullionKeep</span>
                  </h1>
                  
                  <p className="text-slate-400 text-lg font-medium animate-[slideUp_0.5s_ease-out_0.4s_both]">
                      Secure. Private. Intelligent.
                  </p>
                  
                  <div className="mt-12 h-px w-full max-w-[200px] bg-slate-800 animate-[widthExpand_0.8s_ease-out_0.6s_both]"></div>
                  
                  <p className="text-gold-600 mt-8 text-sm font-extrabold tracking-[0.2em] uppercase animate-[fadeIn_0.5s_ease-out_0.8s_both]">
                      STRATEGICALLY DIRECTED & MANAGED BY KUNAL
                  </p>
              </div>
          </div>
      </div>

      {/* Background Decor */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-gold-600/10 rounded-full blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[120px]"></div>
      </div>

      <div className={`w-full max-w-md bg-white/5 backdrop-blur-xl border border-white/10 rounded-3xl p-8 shadow-2xl relative z-10 transition-all duration-1000 delay-300 ${showIntro ? 'translate-y-8 opacity-0' : 'translate-y-0 opacity-100'}`}>
        <div className="text-center mb-6">
          <div className="w-16 h-16 bg-gradient-to-br from-gold-400 to-gold-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-gold-500/20">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">BullionKeep</h1>
          <p className="text-slate-400 mt-2 text-sm">Private Inventory Intelligence</p>
        </div>

        {/* Form Header */}
        <div className="text-center mb-6">
             <h2 className="text-xl font-semibold text-white mb-1 flex items-center justify-center gap-2">
                 {isSignUp ? "Create Account" : <>{getGreeting()} <span className="animate-bounce delay-100">👋</span></>}
             </h2>
             <p className="text-sm text-slate-400">
                 {isSignUp ? "Begin your secure bullion tracking journey." : "Welcome back. Please sign in to continue."}
             </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-5">
          {message && (
            <div className={`p-4 rounded-xl text-sm font-medium flex items-start gap-3 ${
              message.type === 'success' 
                ? 'bg-green-500/10 text-green-400 border border-green-500/20' 
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{message.text}</span>
            </div>
          )}

          <div className="space-y-4">
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-gold-400 transition-colors" />
              <input
                type="email"
                required
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50 transition-all"
              />
            </div>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500 group-focus-within:text-gold-400 transition-colors" />
              <input
                type="password"
                required
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-slate-900/50 border border-slate-700 rounded-xl py-3.5 pl-12 pr-4 text-white placeholder-slate-500 focus:outline-none focus:border-gold-500/50 focus:ring-1 focus:ring-gold-500/50 transition-all"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-gradient-to-r from-gold-500 to-gold-600 text-white font-bold py-4 rounded-xl shadow-lg shadow-gold-500/20 hover:shadow-gold-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                {isSignUp ? 'Create Account' : 'Sign In'}
                <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-400 text-sm">
            {isSignUp ? "Already have an account?" : "Don't have an account?"}
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="ml-2 text-gold-400 hover:text-gold-300 font-semibold transition-colors"
            >
              {isSignUp ? 'Sign In' : 'Sign Up'}
            </button>
          </p>
        </div>

        {/* Added Branding Footer to Card */}
        <div className="mt-8 pt-6 border-t border-white/5 text-center">
            <p className="text-gold-500 text-xs font-extrabold tracking-[0.15em] uppercase">
                Strategically Directed & Managed by Kunal
            </p>
        </div>
      </div>
      
      <p className="mt-8 text-slate-600 text-xs font-mono relative z-10">Secured by Supabase Authentication</p>
    </div>
  );
};

export default Auth;

"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import gsap from "gsap";
import { login as authLogin } from "@/lib/auth";
import styles from "./login.module.css";
import mtn from "../mountains.module.css";

export default function LoginPage() {
  const skyRef = useRef<HTMLDivElement>(null);
  const mountainRef = useRef<HTMLDivElement>(null);
  const cloud1Ref = useRef<HTMLDivElement>(null);
  const cloud2Ref = useRef<HTMLDivElement>(null);
  const snowCanvasRef = useRef<HTMLCanvasElement>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const hasNavigated = useRef(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Navigate to landing on scroll up
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.deltaY < -30 && !hasNavigated.current) {
        hasNavigated.current = true;
        sessionStorage.setItem("comingFromLogin", "true");
        router.push("/");
      }
    },
    [router]
  );

  // Navigate to landing on touch swipe down
  const touchStartY = useRef(0);
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;
      if (deltaY > 60 && !hasNavigated.current) {
        hasNavigated.current = true;
        sessionStorage.setItem("comingFromLogin", "true");
        router.push("/");
      }
    },
    [router]
  );

  useEffect(() => {
    window.addEventListener("wheel", handleWheel, { passive: true });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchend", handleTouchEnd);
    };
  }, [handleWheel, handleTouchStart, handleTouchEnd]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await authLogin(email, password);
      if (!result.ok) {
        setError(result.error || "Login failed");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Something went wrong");
      setLoading(false);
    }
  };

  useEffect(() => {
    // Reset scroll navigation flag so scroll-up-to-home works again
    hasNavigated.current = false;

    // Skip intro when navigating from landing (not on refresh)
    const skipIntro = sessionStorage.getItem("comingFromLanding") === "true";
    sessionStorage.removeItem("comingFromLanding");

    if (skipIntro) {
      // Instantly show everything — no entrance animation
      gsap.set(skyRef.current, { opacity: 1 });
      gsap.set(mountainRef.current, { opacity: 1 });
      gsap.set(cloud1Ref.current, { opacity: 0.6, x: 0 });
      gsap.set(cloud2Ref.current, { opacity: 0.5, x: 0 });
      gsap.set(formRef.current, { opacity: 1, y: 0 });
    } else {
      const tl = gsap.timeline({ delay: 0.3 });

      // Fade in icy sky
      tl.to(skyRef.current, { opacity: 1, duration: 1.6, ease: "power2.inOut" });

      // Fade in mountains
      tl.to(mountainRef.current, { opacity: 1, duration: 1.6, ease: "power2.inOut" }, "<");

      // Cloud animations
      tl.fromTo(cloud1Ref.current, { opacity: 0, x: -80 }, { opacity: 0.6, x: 0, duration: 1.8, ease: "power1.out" }, "-=1.5");
      tl.fromTo(cloud2Ref.current, { opacity: 0, x: 60 }, { opacity: 0.5, x: 0, duration: 2, ease: "power1.out" }, "-=1.6");

      // Form entrance — use fromTo so end state is guaranteed
      tl.fromTo(formRef.current, { opacity: 0, y: 40 }, { opacity: 1, y: 0, duration: 1, ease: "power3.out" }, "-=1.4");
    }

    // Mountains gentle drift (always runs)
    gsap.to(mountainRef.current, {
      y: -30,
      duration: 5,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });

    // Cloud drifts (always run)
    gsap.to(cloud1Ref.current, { x: 30, duration: 14, repeat: -1, yoyo: true, ease: "sine.inOut", delay: skipIntro ? 0 : 2 });
    gsap.to(cloud2Ref.current, { x: -25, duration: 11, repeat: -1, yoyo: true, ease: "sine.inOut", delay: skipIntro ? 0 : 3 });

    // Snow
    const canvas = snowCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const flakes: { x: number; y: number; r: number; speed: number; drift: number; opacity: number }[] = [];
        for (let i = 0; i < 30; i++) {
          flakes.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            r: Math.random() * 2.5 + 1,
            speed: Math.random() * 0.4 + 0.15,
            drift: Math.random() * 0.3 - 0.15,
            opacity: Math.random() * 0.4 + 0.2,
          });
        }

        let animId: number;
        const drawSnow = () => {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          for (const f of flakes) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${f.opacity})`;
            ctx.fill();
            f.y += f.speed;
            f.x += f.drift;
            if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width; }
            if (f.x > canvas.width) f.x = 0;
            if (f.x < 0) f.x = canvas.width;
          }
          animId = requestAnimationFrame(drawSnow);
        };
        setTimeout(() => drawSnow(), skipIntro ? 0 : 800);

        const handleResize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
        window.addEventListener("resize", handleResize);
        return () => { cancelAnimationFrame(animId); window.removeEventListener("resize", handleResize); };
      }
    }
  }, []);

  return (
    <div className={styles.pageWrapper}>
      
      <div className={styles.darkBase} />

      
      <div ref={skyRef} className={styles.icySky} />

      
      <div ref={mountainRef} className={mtn.mountainLayer} style={{ opacity: 0 }}>
        <svg className={mtn.mountainSvg} viewBox="0 0 1440 400" preserveAspectRatio="none">
          <path d="M0,400 L0,280 Q120,180 240,240 Q360,140 480,200 Q560,120 680,180 Q800,80 920,160 Q1040,100 1160,180 Q1280,120 1380,200 L1440,180 L1440,400 Z" fill="#a8c8d8" opacity="0.5" />
          <path d="M0,400 L0,320 Q100,240 200,280 Q320,180 440,260 Q520,200 640,250 Q760,160 880,230 Q1000,180 1120,240 Q1240,200 1360,260 L1440,240 L1440,400 Z" fill="#8fb5c9" opacity="0.6" />
          <path d="M0,400 L0,340 Q160,280 320,320 Q440,260 560,300 Q680,250 800,290 Q920,260 1040,300 Q1160,270 1280,310 L1440,290 L1440,400 Z" fill="#7aa3b8" opacity="0.7" />
          <path d="M480,200 Q520,170 560,190 Q540,180 480,200 Z" fill="white" opacity="0.8" />
          <path d="M800,80 Q840,55 880,75 Q860,60 800,80 Z" fill="white" opacity="0.9" />
          <path d="M1160,180 Q1190,155 1220,175 Q1200,160 1160,180 Z" fill="white" opacity="0.8" />
        </svg>
        <div className={mtn.snowGround} />
      </div>

      {/* ── Clouds ── */}
      <div ref={cloud1Ref} className={styles.cloud1}>
        <svg viewBox="0 0 500 180" xmlns="http://www.w3.org/2000/svg">
          <defs><filter id="lcb1"><feGaussianBlur in="SourceGraphic" stdDeviation="5" /></filter></defs>
          <ellipse cx="250" cy="100" rx="160" ry="50" fill="white" opacity="0.8" filter="url(#lcb1)" />
          <ellipse cx="180" cy="85" rx="100" ry="45" fill="white" opacity="0.75" filter="url(#lcb1)" />
          <ellipse cx="330" cy="90" rx="90" ry="40" fill="white" opacity="0.7" filter="url(#lcb1)" />
        </svg>
      </div>
      <div ref={cloud2Ref} className={styles.cloud2}>
        <svg viewBox="0 0 400 150" xmlns="http://www.w3.org/2000/svg">
          <defs><filter id="lcb2"><feGaussianBlur in="SourceGraphic" stdDeviation="4" /></filter></defs>
          <ellipse cx="200" cy="80" rx="130" ry="40" fill="white" opacity="0.75" filter="url(#lcb2)" />
          <ellipse cx="140" cy="65" rx="80" ry="35" fill="white" opacity="0.7" filter="url(#lcb2)" />
        </svg>
      </div>

      {/* ── Snow ── */}
      <canvas ref={snowCanvasRef} className={styles.snowCanvas} />

      {/* ── Back link ── */}
      <a href="/" className={styles.backLink}>← Back</a>

      {/* ── Login form ── */}
      <div ref={formRef} className={styles.formWrapper}>
        <div className={styles.card}>
          <div className={styles.logoGroup}>
            <Image
              src="/RCP.jpg"
              alt="RCP Logo"
              width={72}
              height={72}
              className={styles.logoImage}
            />
          </div>

          <h1 className={styles.title}>Welcome back</h1>
          <p className={styles.subtitle}>Sign in to your account</p>

          {error && <p className={styles.error}>{error}</p>}

          <form className={styles.form} onSubmit={handleLogin}>
            <div className={styles.fieldGroup}>
              <label htmlFor="email" className={styles.label}>Email</label>
              <input
                id="email"
                type="email"
                placeholder="you@company.com"
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <input
                id="password"
                type="password"
                placeholder="••••••••"
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Signing in..." : "Log In"}
            </button>
          </form>

          <p className={styles.registerLink}>
            Don&apos;t have an account?{" "}
            <a href="/register">Create one</a>
          </p>
        </div>
      </div>
    </div>
  );
}

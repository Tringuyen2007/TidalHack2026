"use client";

import Image from "next/image";
import { useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import gsap from "gsap";
import styles from "./page.module.css";
import mtn from "./mountains.module.css";

export default function Home() {
  const skyRef = useRef<HTMLDivElement>(null);
  const mountainRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const cloud1Ref = useRef<HTMLDivElement>(null);
  const cloud2Ref = useRef<HTMLDivElement>(null);
  const cloud3Ref = useRef<HTMLDivElement>(null);
  const snowCanvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();
  const hasNavigated = useRef(false);

  // Navigate to login on scroll down
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (e.deltaY > 30 && !hasNavigated.current) {
        hasNavigated.current = true;
        sessionStorage.setItem("comingFromLogin", "true");
        sessionStorage.setItem("comingFromLanding", "true");
        router.push("/login");
      }
    },
    [router]
  );

  // Navigate to login on touch swipe up
  const touchStartY = useRef(0);
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);
  const handleTouchEnd = useCallback(
    (e: TouchEvent) => {
      const deltaY = touchStartY.current - e.changedTouches[0].clientY;
      if (deltaY > 60 && !hasNavigated.current) {
        hasNavigated.current = true;
        sessionStorage.setItem("comingFromLogin", "true");
        sessionStorage.setItem("comingFromLanding", "true");
        router.push("/login");
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

  useEffect(() => {
    // Reset scroll navigation flag so scroll-to-login works again
    hasNavigated.current = false;

    // Skip intro only when navigating back from login (not on refresh)
    const skipIntro = sessionStorage.getItem("comingFromLogin") === "true";
    sessionStorage.removeItem("comingFromLogin");

    if (skipIntro) {
      // Instantly show everything — no entrance animation
      gsap.set(skyRef.current, { opacity: 1 });
      gsap.set(mountainRef.current, { opacity: 1 });
      gsap.set(heroRef.current, { opacity: 1, y: 0 });
      gsap.set(cloud1Ref.current, { opacity: 0.7 });
      gsap.set(cloud2Ref.current, { opacity: 0.55 });
      gsap.set(cloud3Ref.current, { opacity: 0.5 });
    } else {
      const tl = gsap.timeline({ delay: 0.5 });

      // Fade in the static icy sky
      tl.to(skyRef.current, {
        opacity: 1,
        duration: 2,
        ease: "power2.inOut",
      });

      // Fade in the mountains at the same time
      tl.to(
        mountainRef.current,
        {
          opacity: 1,
          duration: 2,
          ease: "power2.inOut",
        },
        "<"
      );

      // Animate hero content in
      tl.from(
        heroRef.current,
        {
          opacity: 0,
          y: 60,
          duration: 1.4,
          ease: "power3.out",
        },
        "-=1.5"
      );

      // Cloud 1 — large, slow drift from left
      tl.fromTo(
        cloud1Ref.current,
        { opacity: 0, x: -100 },
        { opacity: 0.7, x: 0, duration: 2, ease: "power1.out" },
        "-=1.8"
      );

      // Cloud 2 — medium, drifts from right
      tl.fromTo(
        cloud2Ref.current,
        { opacity: 0, x: 80 },
        { opacity: 0.55, x: 0, duration: 2.2, ease: "power1.out" },
        "-=2"
      );

      // Cloud 3 — small, slow drift from left
      tl.fromTo(
        cloud3Ref.current,
        { opacity: 0, x: -60 },
        { opacity: 0.5, x: 0, duration: 2.5, ease: "power1.out" },
        "-=2.2"
      );
    }

    // Mountains drift vertically (always runs)
    gsap.to(mountainRef.current, {
      y: -50,
      duration: 4,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
    });

    // Cloud drifts (always run)
    gsap.to(cloud1Ref.current, {
      x: 40,
      duration: 12,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: skipIntro ? 0 : 2,
    });
    gsap.to(cloud2Ref.current, {
      x: -30,
      duration: 9,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: skipIntro ? 0 : 3,
    });
    gsap.to(cloud3Ref.current, {
      x: 25,
      duration: 15,
      repeat: -1,
      yoyo: true,
      ease: "sine.inOut",
      delay: skipIntro ? 0 : 1,
    });

    // ── Subtle snow effect ──
    const canvas = snowCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const flakes: { x: number; y: number; r: number; speed: number; drift: number; opacity: number }[] = [];
        const flakeCount = 35; // sparse — not annoying

        for (let i = 0; i < flakeCount; i++) {
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
            // wrap around
            if (f.y > canvas.height) { f.y = -5; f.x = Math.random() * canvas.width; }
            if (f.x > canvas.width) f.x = 0;
            if (f.x < 0) f.x = canvas.width;
          }
          animId = requestAnimationFrame(drawSnow);
        };
        // Delay snow start until after the background fades in
        setTimeout(() => drawSnow(), skipIntro ? 0 : 2500);

        const handleResize = () => {
          canvas.width = window.innerWidth;
          canvas.height = window.innerHeight;
        };
        window.addEventListener("resize", handleResize);

        return () => {
          cancelAnimationFrame(animId);
          window.removeEventListener("resize", handleResize);
        };
      }
    }
  }, []);

  return (
    <div className={styles.pageWrapper}>
      {/* ── Dark base layer ── */}
      <div className={styles.darkBase} />

      {/* ── Static icy sky (does NOT move) ── */}
      <div ref={skyRef} className={styles.icySky} />

      {/* ── Mountains (drift vertically via GSAP, separate from sky & clouds) ── */}
      <div ref={mountainRef} className={mtn.mountainLayer} style={{ opacity: 0 }}>
        <svg
          className={mtn.mountainSvg}
          viewBox="0 0 1440 400"
          preserveAspectRatio="none"
        >
          <path
            d="M0,400 L0,280 Q120,180 240,240 Q360,140 480,200 Q560,120 680,180 Q800,80 920,160 Q1040,100 1160,180 Q1280,120 1380,200 L1440,180 L1440,400 Z"
            fill="#a8c8d8"
            opacity="0.5"
          />
          <path
            d="M0,400 L0,320 Q100,240 200,280 Q320,180 440,260 Q520,200 640,250 Q760,160 880,230 Q1000,180 1120,240 Q1240,200 1360,260 L1440,240 L1440,400 Z"
            fill="#8fb5c9"
            opacity="0.6"
          />
          <path
            d="M0,400 L0,340 Q160,280 320,320 Q440,260 560,300 Q680,250 800,290 Q920,260 1040,300 Q1160,270 1280,310 L1440,290 L1440,400 Z"
            fill="#7aa3b8"
            opacity="0.7"
          />
          <path d="M480,200 Q520,170 560,190 Q540,180 480,200 Z" fill="white" opacity="0.8" />
          <path d="M800,80 Q840,55 880,75 Q860,60 800,80 Z" fill="white" opacity="0.9" />
          <path d="M1160,180 Q1190,155 1220,175 Q1200,160 1160,180 Z" fill="white" opacity="0.8" />
        </svg>
        <div className={mtn.snowGround} />
      </div>

      {/* ── Clouds (separate layer, move independently) ── */}
      <div ref={cloud1Ref} className={styles.cloud1}>
        <svg viewBox="0 0 500 180" xmlns="http://www.w3.org/2000/svg">
          <defs><filter id="cb1"><feGaussianBlur in="SourceGraphic" stdDeviation="5" /></filter></defs>
          <ellipse cx="250" cy="100" rx="160" ry="50" fill="white" opacity="0.8" filter="url(#cb1)" />
          <ellipse cx="180" cy="85" rx="100" ry="45" fill="white" opacity="0.75" filter="url(#cb1)" />
          <ellipse cx="330" cy="90" rx="90" ry="40" fill="white" opacity="0.7" filter="url(#cb1)" />
          <ellipse cx="220" cy="70" rx="70" ry="35" fill="white" opacity="0.8" filter="url(#cb1)" />
        </svg>
      </div>

      <div ref={cloud2Ref} className={styles.cloud2}>
        <svg viewBox="0 0 400 150" xmlns="http://www.w3.org/2000/svg">
          <defs><filter id="cb2"><feGaussianBlur in="SourceGraphic" stdDeviation="4" /></filter></defs>
          <ellipse cx="200" cy="80" rx="130" ry="40" fill="white" opacity="0.75" filter="url(#cb2)" />
          <ellipse cx="140" cy="65" rx="80" ry="35" fill="white" opacity="0.7" filter="url(#cb2)" />
          <ellipse cx="270" cy="70" rx="70" ry="30" fill="white" opacity="0.65" filter="url(#cb2)" />
        </svg>
      </div>

      <div ref={cloud3Ref} className={styles.cloud3}>
        <svg viewBox="0 0 350 130" xmlns="http://www.w3.org/2000/svg">
          <defs><filter id="cb3"><feGaussianBlur in="SourceGraphic" stdDeviation="4" /></filter></defs>
          <ellipse cx="175" cy="70" rx="110" ry="35" fill="white" opacity="0.7" filter="url(#cb3)" />
          <ellipse cx="120" cy="55" rx="70" ry="30" fill="white" opacity="0.65" filter="url(#cb3)" />
          <ellipse cx="240" cy="60" rx="60" ry="25" fill="white" opacity="0.6" filter="url(#cb3)" />
        </svg>
      </div>

      {/* ── Navigation ── */}
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <div className={styles.logoGroup}>
            <Image
              src="/RCP.jpg"
              alt="RCP Logo"
              width={48}
              height={48}
              className={styles.logoImage}
            />
            <span className={styles.logoName}>Pipely</span>
          </div>
          <a
            href="/login"
            className={styles.navLoginBtn}
            onClick={(e) => {
              e.preventDefault();
              sessionStorage.setItem("comingFromLogin", "true");
              sessionStorage.setItem("comingFromLanding", "true");
              router.push("/login");
            }}
          >
            Log In
          </a>
        </div>
      </nav>

      {/* ── Hero ── */}
      <header ref={heroRef} className={styles.hero}>
        <div className={styles.heroInner}>
          <div className={styles.textContent}>
            <h1 className={styles.headline}>
              Pipeline integrity,
              <br />
              <span className={styles.headlineItalic}>intelligently aligned.</span>
            </h1>

            <p className={styles.subtitle}>
              Automate ILI data alignment, anomaly matching, and
              <br className={styles.subtitleBreak} />
              corrosion growth analysis.
            </p>

            <div className={styles.loginBtnWrapper}>
              <a
                href="/login"
                className={styles.heroLoginBtn}
                onClick={(e) => {
                  e.preventDefault();
                  sessionStorage.setItem("comingFromLogin", "true");
                  sessionStorage.setItem("comingFromLanding", "true");
                  router.push("/login");
                }}
              >
                Get Started
              </a>
            </div>
          </div>
        </div>
      </header>

      {/* ── Subtle snow effect ── */}
      <canvas
        ref={snowCanvasRef}
        className={styles.snowCanvas}
      />

      {/* ── Scroll down indicator ── */}
      <div className={styles.scrollIndicator}>
        <span className={styles.scrollText}>Scroll to log in</span>
        <svg className={styles.scrollArrow} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
      </div>

    </div>
  );
}

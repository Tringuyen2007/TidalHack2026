"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { register, login } from "@/lib/auth";
import styles from "./register.module.css";
import mtn from "../mountains.module.css";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgName, setOrgName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await register({ name, email, password, orgName });
    if (!result.ok) {
      setError(result.error || "Registration failed");
      setLoading(false);
      return;
    }

    // Auto-login after successful registration
    const loginResult = await login(email, password);
    if (loginResult.ok) {
      router.push("/dashboard");
    } else {
      // Registration succeeded but auto-login failed — redirect to login
      router.push("/login");
    }
  };

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.darkBase} />
      <div className={styles.icySky} />

      {/* Mountains */}
      <div className={mtn.mountainLayer}>
        <svg className={mtn.mountainSvg} viewBox="0 0 1440 400" preserveAspectRatio="none">
          <path d="M0,400 L0,280 Q120,180 240,240 Q360,140 480,200 Q560,120 680,180 Q800,80 920,160 Q1040,100 1160,180 Q1280,120 1380,200 L1440,180 L1440,400 Z" fill="#a8c8d8" opacity="0.5" />
          <path d="M0,400 L0,320 Q100,240 200,280 Q320,180 440,260 Q520,200 640,250 Q760,160 880,230 Q1000,180 1120,240 Q1240,200 1360,260 L1440,240 L1440,400 Z" fill="#8fb5c9" opacity="0.6" />
          <path d="M0,400 L0,340 Q160,280 320,320 Q440,260 560,300 Q680,250 800,290 Q920,260 1040,300 Q1160,270 1280,310 L1440,290 L1440,400 Z" fill="#7aa3b8" opacity="0.7" />
        </svg>
        <div className={mtn.snowGround} />
      </div>

      <a href="/login" className={styles.backLink}>← Back to login</a>

      <div className={styles.formWrapper}>
        <div className={styles.card}>
          <div className={styles.logoGroup}>
            <Image src="/RCP.jpg" alt="RCP Logo" width={60} height={60} className={styles.logoImage} />
          </div>

          <h1 className={styles.title}>Create account</h1>
          <p className={styles.subtitle}>Start aligning your ILI data</p>

          {error && <p className={styles.error}>{error}</p>}

          <form className={styles.form} onSubmit={handleRegister}>
            <div className={styles.fieldGroup}>
              <label htmlFor="name" className={styles.label}>Full Name</label>
              <input id="name" type="text" placeholder="Jane Smith" className={styles.input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="email" className={styles.label}>Email</label>
              <input id="email" type="email" placeholder="you@company.com" className={styles.input} value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="password" className={styles.label}>Password</label>
              <input id="password" type="password" placeholder="Min. 8 characters" className={styles.input} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>

            <div className={styles.fieldGroup}>
              <label htmlFor="org" className={styles.label}>Organization</label>
              <input id="org" type="text" placeholder="Your company" className={styles.input} value={orgName} onChange={(e) => setOrgName(e.target.value)} required minLength={2} />
            </div>

            <button type="submit" className={styles.submitBtn} disabled={loading}>
              {loading ? "Creating account..." : "Create Account"}
            </button>
          </form>

          <p className={styles.loginLink}>
            Already have an account? <a href="/login">Sign in</a>
          </p>
        </div>
      </div>
    </div>
  );
}

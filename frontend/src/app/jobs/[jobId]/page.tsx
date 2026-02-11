"use client";

import { redirect } from "next/navigation";

export default async function JobRedirectPage({ params }: { params: { jobId: string } }) {
  // Server-side redirect to backend results page
  const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
  redirect(`${backendUrl}/alignment/${params.jobId}`);
  return null;
}

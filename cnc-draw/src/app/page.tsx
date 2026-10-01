"use client";

import dynamic from "next/dynamic";

// The editor reads localStorage and measures the canvas, so render it only in the browser.
const CncEditor = dynamic(() => import("@/components/CncEditor"), { ssr: false });

export default function Home() {
  return <CncEditor />;
}

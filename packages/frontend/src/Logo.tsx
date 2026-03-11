import React from "react";

export default function Logo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/logo.png"
      alt="CloudGuardian"
      style={{ width: size, height: "auto", maxWidth: "100%", display: "block" }}
    />
  );
}

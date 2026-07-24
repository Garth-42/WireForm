import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HarnessStudio } from "./HarnessStudio";
import "./globals.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("WireForm could not find its application root.");
}

createRoot(root).render(
  <StrictMode>
    <HarnessStudio />
  </StrictMode>,
);

"use client";
import { useEffect, useRef } from "react";

/** Recibe la imagen pegada con ⌘V / Ctrl+V (p. ej. una captura de pantalla del Mac) mientras el componente está en pantalla. Pegar texto no se toca. */
export function usePasteImage(onImage: (file: File) => void, enabled = true) {
  const cb = useRef(onImage);
  useEffect(() => { cb.current = onImage; });
  useEffect(() => {
    if (!enabled) return;
    function onPaste(e: ClipboardEvent) {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.kind === "file" && i.type.startsWith("image/"));
      const file = item?.getAsFile(); if (!file) return;
      e.preventDefault();
      cb.current(new File([file], `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${file.type === "image/jpeg" ? "jpg" : "png"}`, { type: file.type }));
    }
    window.addEventListener("paste", onPaste); return () => window.removeEventListener("paste", onPaste);
  }, [enabled]);
}

/** Lee la imagen del portapapeles con un botón (pide permiso al navegador). Devuelve null si no hay imagen. */
export async function readClipboardImage(): Promise<File | null> {
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith("image/")); if (!type) continue;
    const blob = await it.getType(type);
    return new File([blob], `captura-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${type === "image/jpeg" ? "jpg" : "png"}`, { type });
  }
  return null;
}

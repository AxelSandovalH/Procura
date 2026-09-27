import { ImageResponse } from "next/og";

export const alt = "Procura — Compras entre organizaciones en un solo flujo";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Imagen para compartir el enlace (WhatsApp, LinkedIn, Slack…): símbolo + promesa sobre el gris de la marca. */
export default async function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 90px", background: "#2b2f32", color: "#fff", fontFamily: "Helvetica, Arial, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <svg viewBox="342 281 342 462" width="108" height="146" fill="#fff">
            <path d="M387.00 419.45L387.00 742.79L454.00 698.46L454.00 585.50L512.50 585.50L512.50 636.83L639.03 553.16L512.50 469.24L512.50 519.75L454.00 519.75L454.00 464.01ZM342.07 364.98L468.75 281.29L468.75 331.25L555.50 331.25A126.6 126.6 0 0 1 653.74 537.71L597.56 500.51A60.3 60.3 0 0 0 555.50 397.00L468.75 397.00L468.75 448.36Z" />
          </svg>
          <div style={{ fontSize: 96, fontWeight: 700, letterSpacing: -3 }}>Procura</div>
        </div>
        <div style={{ marginTop: 44, fontSize: 46, lineHeight: 1.2, maxWidth: 940, color: "#e5e5e5" }}>Compras entre organizaciones, en un solo flujo.</div>
        <div style={{ marginTop: 28, fontSize: 28, color: "#a3a3a3" }}>Requisición → Aprobación → Cotización → Orden → Entrega → Recepción</div>
      </div>
    ),
    size,
  );
}

"use client";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

/** Último recurso: falla del layout raíz. Reporta y ofrece recargar. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html lang="es-MX">
      <body style={{ fontFamily: "Helvetica, Arial, sans-serif", display: "grid", minHeight: "100vh", placeItems: "center", margin: 0 }}>
        <div style={{ textAlign: "center", maxWidth: 380, padding: 24 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>Algo salió mal</h1>
          <p style={{ fontSize: 14, color: "#525252", margin: "0 0 16px" }}>Ya registramos el problema. Recarga la página; si sigue igual, inténtalo en unos minutos.</p>
          <button onClick={() => location.reload()} style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#171717", color: "#fff", fontSize: 14, cursor: "pointer" }}>Recargar</button>
        </div>
      </body>
    </html>
  );
}

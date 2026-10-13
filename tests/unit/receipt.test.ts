import { describe, expect, it } from "vitest";
import { sanitizeDate, sniffImage, sniffReceiptFile, toDraft, toMinorChecked, type Receipt } from "@/lib/expenses/receipt-ocr";

const base: Receipt = { is_receipt: true, merchant: " OXXO Los Cabos ", merchant_tax_id: "cmu 8512 12ab3", document_number: " INV-0042 ", date: "2026-10-12", currency: "mxn", total: 182.5, tax: 25.17, payment_method: "CARD",
  description: "Agua, café y botanas", category: "Alimentos", confidence: "high", notes: null };

describe("lectura de tickets: normalización del borrador", () => {
  it("convierte importes a centavos enteros y rechaza valores absurdos", () => {
    expect(toMinorChecked(182.5)).toBe(18250); expect(toMinorChecked(0.1 + 0.2)).toBe(30); expect(toMinorChecked(19.99)).toBe(1999);
    expect(toMinorChecked(null)).toBeNull(); expect(toMinorChecked(-5)).toBeNull(); expect(toMinorChecked(Number.NaN)).toBeNull(); expect(toMinorChecked(5e9)).toBeNull();
  });
  it("valida la fecha: formato real, no futura, no anterior al 2000", () => {
    const now = new Date("2026-10-13T12:00:00Z");
    expect(sanitizeDate("2026-10-12", now)).toBe("2026-10-12"); expect(sanitizeDate("2026-10-14", now)).toBe("2026-10-14"); // tolerancia de un día por zona horaria
    expect(sanitizeDate("2026-10-20", now)).toBeNull(); expect(sanitizeDate("1999-12-31", now)).toBeNull(); expect(sanitizeDate("2026-02-30", now)).toBeNull(); expect(sanitizeDate("12/10/2026", now)).toBeNull(); expect(sanitizeDate(null, now)).toBeNull();
  });
  it("arma un borrador limpio: moneda en mayúsculas, RFC válido sin espacios, descripción acotada", () => {
    const d = toDraft(base, new Date("2026-10-13T12:00:00Z"));
    expect(d.total_minor).toBe(18250); expect(d.tax_minor).toBe(2517); expect(d.currency).toBe("MXN"); expect(d.merchant).toBe("OXXO Los Cabos"); expect(d.merchant_tax_id).toBe("CMU851212AB3");
    expect(d.date).toBe("2026-10-12"); expect(d.confidence).toBe("high"); expect(d.document_number).toBe("INV-0042");
  });
  it("si no se lee el total o la fecha, baja la confianza y avisa en vez de inventar", () => {
    const d = toDraft({ ...base, total: null, date: "2031-01-01", confidence: "high" }, new Date("2026-10-13T12:00:00Z"));
    expect(d.total_minor).toBeNull(); expect(d.date).toBeNull(); expect(d.confidence).toBe("low"); expect(d.notes).toMatch(/fecha/i);
  });
  it("descarta un RFC mal formado y una moneda inválida", () => {
    const d = toDraft({ ...base, merchant_tax_id: "123", currency: "pesos" });
    expect(d.merchant_tax_id).toBeNull(); expect(d.currency).toBe("MXN");
  });
});

describe("tipo de imagen por firma, no por lo que diga el cliente", () => {
  it("reconoce JPEG, PNG y WebP y rechaza lo demás", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]))).toBe("image/webp");
    expect(sniffImage(Buffer.from("%PDF-1.4 no es imagen"))).toBeNull(); expect(sniffImage(Buffer.from("<html>"))).toBeNull(); expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe("también se aceptan PDF de facturas y recibos", () => {
  it("reconoce el PDF por su firma y sigue rechazando lo demás", () => {
    expect(sniffReceiptFile(Buffer.from("%PDF-1.7\n..."))).toBe("application/pdf");
    expect(sniffReceiptFile(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffReceiptFile(Buffer.from("PK\u0003\u0004 zip"))).toBeNull(); expect(sniffReceiptFile(Buffer.from("%PD"))).toBeNull();
    expect(sniffImage(Buffer.from("%PDF-1.7"))).toBeNull(); // una foto no puede ser PDF
  });
});

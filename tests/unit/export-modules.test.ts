import { describe, expect, it } from "vitest";
import { csvCell, toCsv, pesos } from "@/lib/export/csv";
import { MODULES, moduleFor, sectionActive, visibleSections } from "@/lib/ui/modules";

describe("CSV para el equipo contable", () => {
  it("escapa comillas, comas y saltos de línea", () => { expect(csvCell('Dijo "hola", y salió\nya')).toBe('"Dijo ""hola"", y salió\nya"'); });
  it("neutraliza fórmulas, pero no altera números negativos", () => {
    expect(csvCell("=1+1")).toBe("'=1+1"); expect(csvCell("+52 55")).toBe("'+52 55"); expect(csvCell("@cmd")).toBe("'@cmd"); expect(csvCell("-1500.50")).toBe("-1500.50"); expect(csvCell(-12.5)).toBe("-12.5");
  });
  it("vacíos, booleanos y BOM de UTF-8", () => { expect(csvCell(null)).toBe(""); expect(csvCell(true)).toBe("Sí"); expect(toCsv(["a"], [["ñ"]]).startsWith("﻿a\r\nñ\r\n")).toBe(true); });
  it("centavos a pesos", () => { expect(pesos(BigInt(1740000))).toBe(17400); expect(pesos(null)).toBeNull(); });
});

describe("módulos del menú", () => {
  it("son los nueve acordados, en orden", () => { expect(MODULES.map((m) => m.label)).toEqual(["Compras", "Ventas", "Facturas", "Conciliación bancaria", "Finanzas", "Relaciones", "Suscripción", "Catálogo", "Administración"]); });
  it("cada ruta pertenece a su módulo", () => {
    const m = (p: string) => moduleFor(p)?.id;
    expect([m("/gastos"), m("/requisiciones/abc"), m("/aprobaciones"), m("/solicitudes/1"), m("/cotizaciones/2"), m("/ordenes/3"), m("/comprar")]).toEqual(Array(7).fill("compras"));
    expect([m("/ventas/9"), m("/facturas"), m("/banco"), m("/finanzas/exportaciones"), m("/relaciones/clientes"), m("/suscripcion"), m("/catalogo/importar"), m("/administracion/miembros")]).toEqual(["ventas", "facturas", "banco", "finanzas", "relaciones", "suscripcion", "catalogo", "administracion"]);
    expect(m("/inicio")).toBeUndefined();
  });
  it("las secciones se filtran por permisos", () => {
    const compras = MODULES[0]!, can = (p: string) => ["expense.read", "order.read"].includes(p);
    expect(visibleSections(compras, can).map((s) => s.label)).toEqual(["Gastos", "Órdenes"]);
    expect(visibleSections(compras, () => false)).toEqual([]);
  });
  it("en Finanzas, «Exportaciones» no resalta «Resumen» al mismo tiempo", () => {
    const f = MODULES.find((m) => m.id === "finanzas")!;
    expect(f.sections.filter((s) => sectionActive("/finanzas/exportaciones", s)).map((s) => s.label)).toContain("Exportaciones");
  });
});

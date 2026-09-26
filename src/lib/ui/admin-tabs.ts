export const ADMIN_TABS = [
  { href: "/administracion/miembros", label: "Miembros", perms: ["member.read", "member.invite"] },
  { href: "/administracion/roles", label: "Roles", perms: ["role.read", "role.manage"] },
  { href: "/administracion/estructura", label: "Departamentos y ubicaciones", perms: ["department.manage", "location.manage"] },
  { href: "/administracion/flujos", label: "Flujos de aprobación", perms: ["approval_workflow.manage"] },
  { href: "/administracion/organizacion", label: "Organización", perms: ["organization.update", "settings.manage"] },
];

import type { Tx } from "@/lib/db/client";
import { Problem } from "@/lib/http/problem";

interface RequisitionForEngine {
  id: string; organization_id: string; version: number;
  requisition_type: "GOODS" | "SERVICE" | "MIXED";
  department_id: string | null; location_id: string | null;
  requester_membership_id: string | null;
  estimated_total_minor: bigint;
}

interface AppliesTo { requisition_types?: string[]; department_ids?: string[]; location_ids?: string[] }
interface RuleCondition { min_amount_minor?: number; max_amount_minor?: number; department_ids?: string[]; requisition_types?: string[] }

function appliesToMatches(a: AppliesTo, r: RequisitionForEngine): boolean {
  if (a.requisition_types?.length && !a.requisition_types.includes(r.requisition_type)) return false;
  if (a.department_ids?.length && (!r.department_id || !a.department_ids.includes(r.department_id))) return false;
  if (a.location_ids?.length && (!r.location_id || !a.location_ids.includes(r.location_id))) return false;
  return true;
}

function conditionMatches(c: RuleCondition, r: RequisitionForEngine): boolean {
  const total = Number(r.estimated_total_minor);
  if (c.min_amount_minor != null && total < c.min_amount_minor) return false;
  if (c.max_amount_minor != null && total > c.max_amount_minor) return false;
  if (c.requisition_types?.length && !c.requisition_types.includes(r.requisition_type)) return false;
  if (c.department_ids?.length && (!r.department_id || !c.department_ids.includes(r.department_id))) return false;
  return true;
}

/** Elige el workflow aplicable: no-default más específico que matchee > default. null = sin aprobación (auto). */
async function resolveWorkflow(tx: Tx, r: RequisitionForEngine) {
  const workflows = await tx.approval_workflows.findMany({ where: { organization_id: r.organization_id, is_active: true }, include: { approval_rules: { orderBy: { level: "asc" } } } });
  const specific = workflows.filter((w) => !w.is_default && appliesToMatches(w.applies_to as AppliesTo, r));
  const fallback = workflows.find((w) => w.is_default && appliesToMatches(w.applies_to as AppliesTo, r));
  const workflow = specific[0] ?? fallback;
  if (!workflow) return null;
  const levels = workflow.approval_rules.filter((rule) => conditionMatches(rule.condition as RuleCondition, r));
  if (levels.length === 0) return null;
  return { workflow, levels };
}

/** Memberships ACTIVE que pueden decidir un nivel, ya excluyendo al solicitante si la política lo exige. */
async function resolveApprovers(tx: Tx, rule: { approver_type: string; approver_role_id: string | null; approver_membership_id: string | null; approver_scope_policy: string }, r: RequisitionForEngine, allowSelfApprove: boolean): Promise<string[]> {
  let ids: string[] = [];
  if (rule.approver_type === "MEMBERSHIP" && rule.approver_membership_id) {
    const m = await tx.memberships.findFirst({ where: { id: rule.approver_membership_id, status: "ACTIVE" } });
    ids = m ? [m.id] : [];
  } else if (rule.approver_type === "DEPARTMENT_HEAD") {
    if (r.department_id) {
      const dept = await tx.departments.findUnique({ where: { id: r.department_id }, select: { head_membership_id: true } });
      if (dept?.head_membership_id) {
        const m = await tx.memberships.findFirst({ where: { id: dept.head_membership_id, status: "ACTIVE" } });
        ids = m ? [m.id] : [];
      }
    }
  } else if (rule.approver_type === "ROLE" && rule.approver_role_id) {
    const assignments = await tx.role_assignments.findMany({
      where: {
        organization_id: r.organization_id, role_id: rule.approver_role_id, revoked_at: null,
        memberships_role_assignments_membership_idTomemberships: { status: "ACTIVE" },
        ...(rule.approver_scope_policy === "MATCH_REQUISITION_SCOPE"
          ? { OR: [
              { scope_type: "ORGANIZATION" as const },
              ...(r.department_id ? [{ scope_type: "DEPARTMENT" as const, scope_id: r.department_id }] : []),
              ...(r.location_id ? [{ scope_type: "LOCATION" as const, scope_id: r.location_id }] : []),
            ] }
          : {}),
      },
      select: { membership_id: true },
    });
    ids = [...new Set(assignments.map((a) => a.membership_id))];
  }
  if (!allowSelfApprove && r.requester_membership_id) ids = ids.filter((id) => id !== r.requester_membership_id);

  // OD-09: si la regla no resuelve a nadie, fallback a Administrador (con aviso vía auditoría del caller).
  if (ids.length === 0) {
    const admins = await tx.role_assignments.findMany({
      where: { organization_id: r.organization_id, revoked_at: null, roles: { name: "Administrador" }, memberships_role_assignments_membership_idTomemberships: { status: "ACTIVE" } },
      select: { membership_id: true },
    });
    ids = [...new Set(admins.map((a) => a.membership_id))];
    if (!allowSelfApprove && r.requester_membership_id) ids = ids.filter((id) => id !== r.requester_membership_id);
  }
  return ids;
}

export interface StartResult { status: "APPROVED" | "PENDING_APPROVAL"; approvalRequestId: string | null }

/**
 * Arranca (o resuelve instantáneamente) el ciclo de aprobación de una requisición al enviarla.
 * Sin workflow aplicable o sin niveles → aprobación automática (WORKFLOWS.md §1).
 */
export async function startApprovalRequest(tx: Tx, requisition: RequisitionForEngine): Promise<StartResult> {
  const settings = await tx.organization_settings.findUnique({ where: { organization_id: requisition.organization_id } });
  const allowSelfApprove = settings?.requester_can_self_approve ?? false;
  const resolved = await resolveWorkflow(tx, requisition);

  if (!resolved) return { status: "APPROVED", approvalRequestId: null };

  const request = await tx.approval_requests.create({
    data: { requisition_id: requisition.id, organization_id: requisition.organization_id, requisition_version: requisition.version, workflow_id: resolved.workflow.id, status: "PENDING", current_level: resolved.levels[0].level },
  });

  for (const rule of resolved.levels) {
    const approverIds = await resolveApprovers(tx, rule, requisition, allowSelfApprove);
    await tx.approval_steps.create({
      data: { approval_request_id: request.id, organization_id: requisition.organization_id, level: rule.level, rule_id: rule.id, decision_mode: rule.decision_mode, resolved_approver_membership_ids: approverIds },
    });
  }
  return { status: "PENDING_APPROVAL", approvalRequestId: request.id };
}

export type DecisionKind = "APPROVE" | "REJECT" | "REQUEST_CHANGES";

export interface DecisionResult { requisitionStatus: "APPROVED" | "REJECTED" | "DRAFT" | "PENDING_APPROVAL"; requestStatus: string; stepAdvanced: boolean }

/** Aplica una decisión del aprobador resuelto del nivel actual. Lanza Problem si no corresponde. */
export async function recordDecision(tx: Tx, requisitionId: string, membershipId: string, decision: DecisionKind, comment: string | undefined, conceptId: string | undefined): Promise<DecisionResult> {
  const request = await tx.approval_requests.findFirst({ where: { requisition_id: requisitionId, status: "PENDING" } });
  if (!request || request.current_level == null) throw Problem.conflict("Esta requisición no tiene una aprobación pendiente");

  const step = await tx.approval_steps.findFirst({ where: { approval_request_id: request.id, level: request.current_level } });
  if (!step || step.status !== "PENDING") throw Problem.conflict("El nivel actual ya fue resuelto");
  if (!step.resolved_approver_membership_ids.includes(membershipId)) throw Problem.forbidden("No eres un aprobador resuelto de este nivel");

  await tx.approval_decisions.create({ data: { step_id: step.id, organization_id: request.organization_id, membership_id: membershipId, decision, comment, concept_id: conceptId } });

  if (decision === "REJECT") {
    await tx.approval_steps.update({ where: { id: step.id }, data: { status: "REJECTED", resolved_at: new Date() } });
    await tx.approval_requests.update({ where: { id: request.id }, data: { status: "REJECTED", completed_at: new Date() } });
    await tx.requisitions.update({ where: { id: requisitionId }, data: { status: "REJECTED", rejected_at: new Date() } });
    return { requisitionStatus: "REJECTED", requestStatus: "REJECTED", stepAdvanced: false };
  }

  if (decision === "REQUEST_CHANGES") {
    await tx.approval_requests.update({ where: { id: request.id }, data: { status: "CHANGES_REQUESTED", completed_at: new Date() } });
    await tx.requisitions.update({ where: { id: requisitionId }, data: { status: "DRAFT" } });
    return { requisitionStatus: "DRAFT", requestStatus: "CHANGES_REQUESTED", stepAdvanced: false };
  }

  // APPROVE
  let stepResolved = step.decision_mode === "ANY_ONE";
  if (step.decision_mode === "ALL") {
    const decisions = await tx.approval_decisions.findMany({ where: { step_id: step.id, decision: "APPROVE" }, select: { membership_id: true } });
    const approvedBy = new Set(decisions.map((d) => d.membership_id));
    stepResolved = step.resolved_approver_membership_ids.every((id) => approvedBy.has(id));
  }
  if (!stepResolved) return { requisitionStatus: "PENDING_APPROVAL", requestStatus: "PENDING", stepAdvanced: false };

  await tx.approval_steps.update({ where: { id: step.id }, data: { status: "APPROVED", resolved_at: new Date() } });

  const nextStep = await tx.approval_steps.findFirst({ where: { approval_request_id: request.id, level: { gt: step.level } }, orderBy: { level: "asc" } });
  if (nextStep) {
    await tx.approval_requests.update({ where: { id: request.id }, data: { current_level: nextStep.level } });
    return { requisitionStatus: "PENDING_APPROVAL", requestStatus: "PENDING", stepAdvanced: true };
  }

  await tx.approval_requests.update({ where: { id: request.id }, data: { status: "APPROVED", completed_at: new Date() } });
  const req = await tx.requisitions.update({ where: { id: requisitionId }, data: { status: "APPROVED", approved_at: new Date() } });
  await tx.requisitions.update({ where: { id: requisitionId }, data: { approved_version: req.version } });
  return { requisitionStatus: "APPROVED", requestStatus: "APPROVED", stepAdvanced: false };
}

/** Campos que definen un cambio "material" (WORKFLOWS.md §1): dispara re-aprobación según política. */
export function isMaterialConceptChange(): boolean { return true; } // toda alta/baja/edición de concepto es material en MVP

export type ReapprovalPolicy = "ALWAYS" | "IF_AMOUNT_INCREASES" | "NEVER";

/**
 * Tras un cambio material en una requisición APPROVED, decide si dispara re-aprobación.
 * Si sí: la ApprovalRequest previa (si queda alguna APPROVED) no existe ya como "activa" — se crea
 * una nueva PENDING referenciando la nueva versión; el estado vuelve a PENDING_APPROVAL.
 */
export async function maybeTriggerReapproval(tx: Tx, requisitionId: string, policy: ReapprovalPolicy, totalBefore: bigint, totalAfter: bigint): Promise<"REAPPROVAL_STARTED" | "NO_CHANGE"> {
  if (policy === "NEVER") return "NO_CHANGE";
  if (policy === "IF_AMOUNT_INCREASES" && totalAfter <= totalBefore) return "NO_CHANGE";

  const requisition = await tx.requisitions.update({ where: { id: requisitionId }, data: { version: { increment: 1 }, status: "PENDING_APPROVAL" } });
  await tx.approval_requests.updateMany({ where: { requisition_id: requisitionId, status: { in: ["APPROVED", "CHANGES_REQUESTED"] } }, data: { status: "SUPERSEDED" } });
  const result = await startApprovalRequest(tx, requisition);
  if (result.status === "APPROVED") {
    await tx.requisitions.update({ where: { id: requisitionId }, data: { status: "APPROVED", approved_at: new Date(), approved_version: requisition.version } });
  }
  return "REAPPROVAL_STARTED";
}

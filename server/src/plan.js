export const PLAN_LIMITS={
  starter:{metaConnections:1,teamMembers:3},
  growth:{metaConnections:3,teamMembers:10},
  business:{metaConnections:10,teamMembers:30},
  enterprise:{metaConnections:50,teamMembers:200}
};
export function planLimits(plan='starter'){return PLAN_LIMITS[plan]||PLAN_LIMITS.starter}

/**
 * RBAC 权限校验中间件
 * ------------------------------------------------------------
 * 基于角色的访问控制（RBAC），需在 jwtAuth 中间件之后使用。
 * 通过 requirePermission(permissionCode) 生成中间件，
 * 校验 ctx.state.user.role 是否拥有对应权限。
 *
 * 角色与权限映射说明：
 *   注：shared/constants.js 中的 USER_ROLE 面向前端用户（user/merchant/admin），
 *   此处为管理员后台专用角色，遵循同样的"枚举小写字符串"定义模式。
 *
 *   super_admin : 超级管理员，拥有所有权限
 *   admin       : 普通管理员，除 admin:user:manage 与 admin:log:delete 外的所有权限
 *   operator    : 运营人员，仅拥有下列权限：
 *                 post:read、comment:read、comment:delete、user:read、
 *                 report:read、report:handle、log:read
 *
 * 无权限时返回 5001 (ROLE_DENIED)。
 *
 * 用法：
 *   router.post('/users', requirePermission('admin:user:manage'), userController.create)
 */
const { ERRORS, ERROR_MESSAGES } = require('../../../../shared/errors')

/** 管理员后台角色枚举 */
const ADMIN_ROLE = {
  SUPER_ADMIN: 'super_admin', // 超级管理员
  ADMIN: 'admin', // 普通管理员
  OPERATOR: 'operator' // 运营人员
}

/** 普通管理员被排除的权限（不具备的权限） */
const ADMIN_EXCLUDED_PERMISSIONS = ['admin:user:manage', 'admin:log:delete']

/** 运营人员拥有的权限白名单 */
const OPERATOR_PERMISSIONS = [
  'post:read',
  'comment:read',
  'comment:delete',
  'user:read',
  'report:read',
  'report:handle',
  'feedback:read',
  'feedback:handle',
  'log:read',
  // 与 003_seed_permissions.sql 种子对齐：operator 角色拥有 stats:read（此前运行时白名单缺失导致运营看不了统计）
  'stats:read'
]

/**
 * 判断指定角色是否拥有某权限
 * @param {string} role 角色
 * @param {string} permissionCode 权限码
 * @returns {boolean}
 */
function hasPermission(role, permissionCode) {
  switch (role) {
    case ADMIN_ROLE.SUPER_ADMIN:
      // 超级管理员拥有所有权限
      return true
    case ADMIN_ROLE.ADMIN:
      // 普通管理员：除排除项外的所有权限
      return !ADMIN_EXCLUDED_PERMISSIONS.includes(permissionCode)
    case ADMIN_ROLE.OPERATOR:
      // 运营人员：仅白名单内的权限
      return OPERATOR_PERMISSIONS.includes(permissionCode)
    default:
      // 未知角色无任何权限
      return false
  }
}

/**
 * 权限校验中间件工厂
 * @param {string} permissionCode 需要的权限码，如 'admin:user:manage'
 * @returns {Function} Koa 中间件
 */
function requirePermission(permissionCode) {
  return async (ctx, next) => {
    // 从 ctx.state.user 读取当前用户信息（由 jwtAuth 中间件挂载）
    const user = ctx.state && ctx.state.user
    if (!user || !user.role) {
      // 未登录或未挂载用户信息，返回未登录
      ctx.body = {
        code: ERRORS.UNAUTHORIZED,
        data: null,
        message: ERROR_MESSAGES[ERRORS.UNAUTHORIZED]
      }
      ctx.status = 200
      return
    }

    // 校验当前角色是否具备所需权限
    if (!hasPermission(user.role, permissionCode)) {
      ctx.body = {
        code: ERRORS.ROLE_DENIED,
        data: null,
        message: ERROR_MESSAGES[ERRORS.ROLE_DENIED]
      }
      ctx.status = 200
      return
    }

    // 权限校验通过，继续执行后续中间件 / 控制器
    await next()
  }
}

module.exports = {
  requirePermission,
  hasPermission,
  ADMIN_ROLE,
  ADMIN_EXCLUDED_PERMISSIONS,
  OPERATOR_PERMISSIONS
}

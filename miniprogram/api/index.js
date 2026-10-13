// api/index.js
// API 聚合入口
// 统一导出所有业务模块，业务方通过 `const api = require('./api')` 一次性引入

const user = require('./modules/user')
const post = require('./modules/post')
const comment = require('./modules/comment')
const like = require('./modules/like')
const favorite = require('./modules/favorite')
const block = require('./modules/block')
const report = require('./modules/report')
const lostfound = require('./modules/lostfound')
const verify = require('./modules/verify')
const common = require('./modules/common')
const notify = require('./modules/notify')
const feedback = require('./modules/feedback')

module.exports = {
  user,
  post,
  comment,
  like,
  favorite,
  block,
  report,
  lostfound,
  verify,
  common,
  notify,
  feedback
}

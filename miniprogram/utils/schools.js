// utils/schools.js
// 学校名录 + 当前学校（首页左上角「定位学校」选择器）
// ------------------------------------------------------------
// 说明：
// 1. 当前为小程序端静态名单（MVP）。后续接入云端时，只需替换 SCHOOLS 的数据来源
//    （例如改为 initDB 的 schools 集合 / 接口拉取），getById / getDefault / getCurrent /
//    setCurrent 的调用方无需改动。
// 2. 字段约定：
//    id          稳定标识，本地存储依赖它，**改名会导致老用户选择丢失**
//    name        学校全称（选择面板展示）
//    shortName   导航栏简称，建议 ≤4 字（左上角可用宽度有限，约 79px）
//    city        所在地（选择面板副标题）
//    recommended 是否为「定位推荐」学校；列表中至多一个，作为默认选中项
// 3. 本地只存 id，不存整个对象，名单调整后依然可用。

const storage = require('./storage.js')

// 本地存储键（存的是 school.id）
const STORAGE_KEY = 'current_school_id'

// 学校名单：杭电信工为当前定位推荐学校（临安青山湖）
const SCHOOLS = [
  {
    id: 'hziee',
    name: '杭州电子科技大学信息工程学院',
    shortName: '杭电信工',
    city: '杭州 · 临安',
    recommended: true
  },
  {
    id: 'zafu',
    name: '浙江农林大学',
    shortName: '浙农林',
    city: '杭州 · 临安'
  },
  {
    id: 'hmc',
    name: '杭州医学院',
    shortName: '杭医',
    city: '杭州 · 临安'
  }
]

/**
 * 获取全部学校
 * @returns {Array} 学校列表（只读，调用方勿直接修改）
 */
function getList() {
  return SCHOOLS
}

/**
 * 获取「定位推荐」学校（无标记时降级为列表首项）
 * @returns {object} 学校对象
 */
function getDefault() {
  for (let i = 0; i < SCHOOLS.length; i++) {
    if (SCHOOLS[i].recommended) return SCHOOLS[i]
  }
  return SCHOOLS[0]
}

/**
 * 按 id 查找学校
 * @param {string} id 学校 id
 * @returns {object|null} 学校对象，未命中返回 null
 */
function getById(id) {
  if (!id) return null
  for (let i = 0; i < SCHOOLS.length; i++) {
    if (SCHOOLS[i].id === id) return SCHOOLS[i]
  }
  return null
}

/**
 * 获取当前学校：优先取本地已选，其次取定位推荐
 * 注：名单调整导致本地 id 失效时，自动回落到定位推荐学校，不会返回空
 * @returns {object} 学校对象
 */
function getCurrent() {
  return getById(storage.get(STORAGE_KEY, '')) || getDefault()
}

/**
 * 写入当前学校并持久化
 * @param {string} id 学校 id
 * @returns {object|null} 写入成功返回学校对象，id 无效返回 null
 */
function setCurrent(id) {
  const school = getById(id)
  if (!school) return null
  storage.set(STORAGE_KEY, school.id)
  return school
}

module.exports = {
  getList,
  getDefault,
  getById,
  getCurrent,
  setCurrent
}

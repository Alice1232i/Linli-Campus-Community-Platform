// utils/markdown.js
// 轻量 Markdown 解析器
// 将 markdown 文本解析为微信 <rich-text> 可用的 nodes 数组
// 支持语法：
//   # / ## / ###   标题
//   - / *          无序列表
//   **加粗**        加粗
//   ![alt](url)    图片（标准语法）
//   [图片](url)     图片（简写语法）
//   普通段落         连续非空行合并为一段，行间以 <br> 分隔

/**
 * 解析内联标记（加粗、图片），返回子节点数组
 * @param {string} text 单行文本
 * @returns {Array} rich-text 子节点
 */
function parseInline(text) {
  const children = []
  // 同时匹配：图片(带alt) | 图片(简写) | 加粗
  const regex = /!\[([^\]]*)\]\(([^)]+)\)|\[图片\]\(([^)]+)\)|\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) {
    // 匹配前的普通文本
    if (match.index > lastIndex) {
      children.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }
    if (match[2] !== undefined) {
      // ![alt](url) 标准图片
      children.push({
        type: 'node', name: 'img',
        attrs: { src: match[2], style: 'max-width:100%;border-radius:8rpx;' },
        children: []
      })
    } else if (match[3] !== undefined) {
      // [图片](url) 简写图片
      children.push({
        type: 'node', name: 'img',
        attrs: { src: match[3], style: 'max-width:100%;border-radius:8rpx;' },
        children: []
      })
    } else if (match[4] !== undefined) {
      // **加粗**
      children.push({
        type: 'node', name: 'strong', attrs: {},
        children: [{ type: 'text', text: match[4] }]
      })
    }
    lastIndex = regex.lastIndex
  }
  // 剩余普通文本
  if (lastIndex < text.length) {
    children.push({ type: 'text', text: text.slice(lastIndex) })
  }
  return children
}

/**
 * 创建标题节点
 */
function headingNode(tag, text) {
  return {
    type: 'node', name: tag, attrs: { style: 'font-weight:bold;margin:12rpx 0;' },
    children: parseInline(text)
  }
}

/**
 * 解析 markdown 文本为 rich-text nodes
 * @param {string} markdownText markdown 文本
 * @returns {Array} rich-text nodes 数组
 */
function parse(markdownText) {
  const lines = (markdownText || '').split(/\r?\n/)
  const nodes = []
  let listItems = []   // 累积连续列表项
  let paraLines = []   // 累积连续段落行

  // 刷新列表
  function flushList() {
    if (!listItems.length) return
    nodes.push({
      type: 'node', name: 'ul', attrs: { style: 'padding-left:20rpx;' },
      children: listItems.map(text => ({
        type: 'node', name: 'li', attrs: {},
        children: parseInline(text)
      }))
    })
    listItems = []
  }

  // 刷新段落
  function flushPara() {
    if (!paraLines.length) return
    const children = []
    paraLines.forEach((line, idx) => {
      if (idx > 0) {
        children.push({ type: 'node', name: 'br', attrs: {}, children: [] })
      }
      const inline = parseInline(line)
      for (let i = 0; i < inline.length; i++) children.push(inline[i])
    })
    nodes.push({
      type: 'node', name: 'p', attrs: { style: 'margin:8rpx 0;line-height:1.6;' },
      children
    })
    paraLines = []
  }

  let match
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // 空行：分隔块
    if (line === '') {
      flushList()
      flushPara()
      continue
    }

    // 三级标题
    if ((match = line.match(/^###\s+(.*)$/))) {
      flushList(); flushPara()
      nodes.push(headingNode('h3', match[1]))
    } else if ((match = line.match(/^##\s+(.*)$/))) {
      // 二级标题
      flushList(); flushPara()
      nodes.push(headingNode('h2', match[1]))
    } else if ((match = line.match(/^#\s+(.*)$/))) {
      // 一级标题
      flushList(); flushPara()
      nodes.push(headingNode('h1', match[1]))
    } else if ((match = line.match(/^[-*]\s+(.*)$/))) {
      // 列表项
      flushPara()
      listItems.push(match[1])
    } else {
      // 普通段落
      flushList()
      paraLines.push(line)
    }
  }

  flushList()
  flushPara()
  return nodes
}

module.exports = {
  parse
}

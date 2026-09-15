'use strict';
/**
 * 文件文本提取：Word(.docx) / PDF / TXT / MD
 * 说明：.doc（旧版二进制）无法在纯 JS 环境下解析，会给出明确提示。
 */
const mammoth = require('mammoth');
const { PDFParse } = require('pdf-parse');

/** 根据文件名与 Buffer 提取纯文本 */
async function extractText(filename, buf) {
  const name = String(filename || '').toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv') || name.endsWith('.json')) {
    return buf.toString('utf8');
  }
  if (name.endsWith('.docx')) {
    const r = await mammoth.extractRawText({ buffer: buf });
    return r.value || '';
  }
  if (name.endsWith('.pdf')) {
    const parser = new PDFParse({ data: buf });
    const r = await parser.getText();
    await parser.destroy().catch(() => {});
    return (r.text || '').trim();
  }
  if (name.endsWith('.doc')) {
    throw new Error('暂不支持旧版 .doc 二进制格式，请另存为 .docx 或复制文字粘贴');
  }
  throw new Error(`暂不支持的文件类型：${filename || '未知'}。支持 txt / md / docx / pdf`);
}

module.exports = { extractText };

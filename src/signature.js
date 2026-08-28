/**
 * signature.js — 领克网关的两套签名体系
 *
 * 1) H5 签名（大写 X-Ca-* 头，Weex buildApiSigature 风格）
 *    待签串：METHOD\nAccept\nContent-MD5\nContent-Type\nDate\n
 *            X-Ca-Key:..\nX-Ca-Nonce:..\nX-Ca-Signature-Method:..\nX-Ca-Timestamp:..\n
 *            path[?排序后的query]
 *    注：Content-MD5 与 Date 留空；Accept 为通配、Content-Type=application/json
 *
 * 2) 原生 SDK 签名（小写 x-ca-* 头，阿里云 API 网关 SDK 风格）
 *    待签串：METHOD\nAccept\nContent-MD5\nContent-Type\nDate\n
 *            参与签名的 x-ca-* 头按字典序逐行 "name:value\n"
 *            path[?排序后的query]
 *    注：Content-MD5=Base64(MD5(body))，body 为 "{}" 也必须计算；
 *        Date 为 RFC1123 GMT；签名头顺序 x-ca-nonce,x-ca-key,x-ca-timestamp
 */
"use strict";

const H5_SIGNATURE_HEADERS = "X-Ca-Key,X-Ca-Timestamp,X-Ca-Nonce,X-Ca-Signature-Method";
const NATIVE_SIGNATURE_HEADERS = "x-ca-nonce,x-ca-key,x-ca-timestamp";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** RFC 1123 GMT 日期，如 "Thu, 13 Aug 2026 03:00:00 GMT" */
function httpDate(now) {
  const date = now || new Date();
  return (
    WEEKDAYS[date.getUTCDay()] + ", " +
    String(date.getUTCDate()).padStart(2, "0") + " " +
    MONTHS[date.getUTCMonth()] + " " +
    date.getUTCFullYear() + " " +
    String(date.getUTCHours()).padStart(2, "0") + ":" +
    String(date.getUTCMinutes()).padStart(2, "0") + ":" +
    String(date.getUTCSeconds()).padStart(2, "0") + " GMT"
  );
}

/** 本地时区 "YYYY-MM-DD HH:mm:ss"（分享风控时间戳用） */
function formatRiskOpenTime(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return year + "-" + month + "-" + day + " " + hours + ":" + minutes + ":" + seconds;
}

/**
 * query 参数按名字 ASCII 升序重排。
 * 输入可为 "?a=1&b=2" 或 "a=1&b=2"；输出不带前导 "?" 的排序串。
 * 值不做重编码（与请求 URL 保持一致）。
 */
function sortQuery(queryString) {
  const query = String(queryString || "").replace(/^\?/, "");
  if (!query) return "";
  const entries = query.split("&").filter(Boolean).map((entry) => {
    const eqIndex = entry.indexOf("=");
    if (eqIndex < 0) return { name: entry, value: "" };
    return { name: entry.slice(0, eqIndex), value: entry.slice(eqIndex + 1) };
  });
  entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  return entries.map((entry) => entry.name + (entry.value ? "=" + entry.value : "")).join("&");
}

/** 拆分 path 与 query，返回 { path, query(sorted) } */
function splitPathAndQuery(uri) {
  const questionIndex = String(uri).indexOf("?");
  if (questionIndex < 0) return { path: uri, query: "" };
  return {
    path: uri.slice(0, questionIndex),
    query: sortQuery(uri.slice(questionIndex + 1)),
  };
}

function buildPathPart(uri) {
  const { path, query } = splitPathAndQuery(uri);
  return query ? path + "?" + query : path;
}

/**
 * H5 签名待签字符串。
 * @param {object} input { method, uri, xCaKey, nonce, timestamp }
 */
function buildH5SignString(input) {
  return [
    String(input.method).toUpperCase(),
    "*/*",
    "",
    "application/json",
    "",
    "X-Ca-Key:" + input.xCaKey,
    "X-Ca-Nonce:" + input.nonce,
    "X-Ca-Signature-Method:HmacSHA256",
    "X-Ca-Timestamp:" + input.timestamp,
    buildPathPart(input.uri),
  ].join("\n");
}

/**
 * 原生 SDK 签名待签字符串。
 * @param {object} input {
 *   method, uri, body,
 *   xCaKey, nonce, timestamp, date,
 *   extraCaHeaders: { name: value } 额外的参与签名的小写 x-ca-* 头
 * }
 * @returns {object} { signString, contentMd5 }
 */
function buildNativeSignString(input) {
  const bodyText = input.body == null ? "" : String(input.body);
  const contentMd5 = md5Base64(bodyText);

  const caHeaders = {};
  caHeaders["x-ca-key"] = input.xCaKey;
  caHeaders["x-ca-nonce"] = input.nonce;
  caHeaders["x-ca-timestamp"] = String(input.timestamp);
  const extra = input.extraCaHeaders || {};
  Object.keys(extra).forEach((name) => {
    const normalized = String(name).toLowerCase();
    if (extra[name] != null && !(normalized in caHeaders)) {
      caHeaders[normalized] = String(extra[name]);
    }
  });

  const names = Object.keys(caHeaders).sort();
  const lines = [
    String(input.method).toUpperCase(),
    "*/*",
    contentMd5,
    "application/json",
    input.date || httpDate(),
  ];
  names.forEach((name) => lines.push(name + ":" + caHeaders[name]));
  lines.push(buildPathPart(input.uri));

  return {
    signString: lines.join("\n"),
    contentMd5,
  };
}

/** 完整 H5 签名请求头（含 X-Ca-Signature 与 Signature-Headers 声明） */
function buildH5SignedHeaders(input) {
  return {
    "X-Ca-Key": input.xCaKey,
    "X-Ca-Nonce": input.nonce,
    "X-Ca-Timestamp": String(input.timestamp),
    "X-Ca-Signature": input.signature,
    "X-Ca-Signature-Method": "HmacSHA256",
    "X-Ca-Signature-Headers": H5_SIGNATURE_HEADERS,
  };
}

/** 完整原生签名请求头（含 Content-MD5、Date 与签名头声明） */
function buildNativeSignedHeaders(input) {
  return {
    "x-ca-key": input.xCaKey,
    "x-ca-nonce": input.nonce,
    "x-ca-timestamp": String(input.timestamp),
    "x-ca-signature": input.signature,
    "Content-MD5": input.contentMd5,
    Date: input.date || httpDate(),
    "X-Ca-Signature-Headers": NATIVE_SIGNATURE_HEADERS,
  };
}

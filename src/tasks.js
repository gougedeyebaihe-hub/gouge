/**
 * tasks.js — 每日任务编排：续期 → 签到 → 分享（含积分验证）
 *
 * context: { config, tokenState, httpClient, store, notification, now }
 */
"use strict";

/* ---------------- 签到状态解析（day/info 响应） ---------------- */

function normalizeDateKey(value) {
  const match = String(value || "").match(/^(\d{4})[-/年]?(\d{1,2})[-/月]?(\d{1,2})/);
  if (!match) return "";
  return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function isDateLikeKey(key) {
  return Boolean(normalizeDateKey(key));
}

function isSignStatusPath(path) {
  const normalized = String(path || "").toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized.includes("issign") ||
    normalized.includes("signed") ||
    normalized.includes("hassigned") ||
    normalized.includes("todaysign") ||
    normalized.includes("signflag") ||
    normalized.includes("signstatus") ||
    (
      (normalized.includes("sign") || normalized.includes("task") || normalized.includes("reward")) &&
      (
        normalized.includes("status") ||
        normalized.includes("state") ||
        normalized.includes("complete") ||
        normalized.includes("finish")
      )
    )
  );
}

function signStatusValueToState(value) {
  if (value === true) return "signed";
  if (value === false) return "unsigned";
  if (typeof value === "number") {
    if (value === 1 || value === 200) return "signed";
    if (value === 0) return "unsigned";
  }
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (
    ["1", "true", "yes", "signed", "complete", "completed", "finish", "finished", "success", "ok"]
      .includes(normalized)
  ) {
    return "signed";
  }
  if (
    ["0", "false", "no", "unsigned", "incomplete", "unfinished"].includes(normalized) ||
    normalized.includes("not signed") ||
    normalized.includes("未签到") ||
    normalized.includes("待签到") ||
    normalized.includes("去签到") ||
    normalized.includes("未完成")
  ) {
    return "unsigned";
  }
  if (
    normalized.includes("已签到") ||
    normalized.includes("已完成") ||
    normalized.includes("已领取")
  ) {
    return "signed";
  }
  return "";
}

function findSignCompletionState(value, path) {
  if (!value || typeof value !== "object") return "";
  const currentPath = path || "";
  const directState = isSignStatusPath(currentPath) ? signStatusValueToState(value) : "";
  if (directState) return directState;
  const keys = Object.keys(value);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const nestedPath = currentPath ? currentPath + "." + key : key;
    const candidate = value[key];
    const state = candidate && typeof candidate === "object"
      ? findSignCompletionState(candidate, nestedPath)
      : isSignStatusPath(nestedPath) ? signStatusValueToState(candidate) : "";
    if (state) return state;
  }
  return "";
}

/** 判断今日是否已签到：优先按日期 map 取今天的 entry，否则全响应递归 */
function getTodaySignState(payload, now) {
  const todayKey = localDayKey(now || new Date());
  const data = payload && payload.data;
  if (data && typeof data === "object") {
    const dateKeys = Object.keys(data).filter(isDateLikeKey);
    if (dateKeys.length) {
      const todayEntry = getEntryByDateKey(data, todayKey);
      if (!todayEntry) return "";
      return findSignCompletionState(todayEntry, todayKey) || "unsigned";
    }
  }
  return findSignCompletionState(payload);
}

function getEntryByDateKey(data, dateKey) {
  const target = normalizeDateKey(dateKey);
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    if (normalizeDateKey(key) === target) return data[key];
  }
  return null;
}

/* ---------------- 签到 ---------------- */

async function runSignTask(context, report) {
  const { config, httpClient, store, now } = context;
  const label = "Sign";

  // 1) 查今日状态
  let dayInfo = null;
  try {
    dayInfo = await getSignDayInfo(context);
    const state = getTodaySignState(dayInfo.payload, now);
    if (state === "signed") {
      report.sign = { ok: true, already: true };
      return { ok: true, already: true };
    }
  } catch (error) {
    report.signError = error;
    // 查询失败不阻断：继续尝试签到
  }

  // 2) 执行签到
  try {
    const upgradeResult = await postSignUpgrade(context);
    const payload = upgradeResult.payload;
    const message = payload && (payload.message || payload.msg || "");
    if (isAlreadySignedMessage(message) || isAlreadySignedMessage(upgradeResult.data)) {
      report.sign = { ok: true, already: true };
      return { ok: true, already: true };
    }
    // 成功后复查状态，确认生效
    let confirmed = true;
    if (dayInfo) {
      try {
        const afterInfo = await getSignDayInfo(context);
        if (getTodaySignState(afterInfo.payload, now) === "unsigned") confirmed = false;
      } catch (error) {
        // 复查失败以升级接口响应为准
      }
    }
    report.sign = { ok: confirmed };
    if (confirmed) {
      report.signMessage = (payload && (payload.message || payload.msg)) || "";
    } else {
      report.signError = new Error("Sign upgrade returned success but day info still reports unsigned.");
      return { ok: false, message: "sign not confirmed" };
    }
    return { ok: true };
  } catch (error) {
    report.signError = error;
    return { ok: false, message: error.message };
  }
}

/* ---------------- 分享 ---------------- */

function extractShareCode(data) {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") return data.shareCode || data.code || data.share_code || "";
  return "";
}

async function requestShareCodeWithValidation(context, validation) {
  const result = await getShareCode(context, {
    validation,
    openTimeStamp: formatRiskOpenTime(context.now || new Date()),
  });
  return extractShareCode(result);
}

/** 获取分享码；需要验证时走 certifyId 流程（存储 → security/config） */
async function obtainShareCode(context) {
  try {
    return await requestShareCodeWithValidation(context, null);
  } catch (initialError) {
    if (!isNeedShareValidationError(initialError)) throw initialError;

    const storedValidation = readStoredShareValidation(context.store);
    if (storedValidation) {
      try {
        return await requestShareCodeWithValidation(context, storedValidation);
      } catch (storedError) {
        if (!isNeedShareValidationError(storedError) && !isHttp403Error(storedError)) throw storedError;
      }
    }

    const validation = await fetchSecurityCertifyId(context);
    if (!validation) {
      throw new Error(
        "Share code failed: share.need.validate.check. Open Lynk & Co and share once manually, then retry.",
      );
    }
    writeStoredShareValidation(context.store, validation);
    try {
      return await requestShareCodeWithValidation(context, validation);
    } catch (validationError) {
      if (!isNeedShareValidationError(validationError) && !isHttp403Error(validationError)) {
        throw validationError;
      }
      throw new Error(
        "Share code failed: share.need.validate.check. Open Lynk & Co and share once manually, then retry.",
      );
    }
  }
}

function extractPoint(payload) {
  const data = payload && payload.data;
  if (!data) return null;
  if (typeof data === "object") {
    if (data.point != null) return Number(data.point);
    if (data.energy != null) return Number(data.energy);
    if (data.totalPoint != null) return Number(data.totalPoint);
  }
  return null;
}

async function runShareTask(context, report) {
  const { config } = context;

  let articleId = config.articleId;
  try {
    if (!articleId) {
      articleId = await getFirstArticle(context);
      context.config = Object.assign({}, config, { articleId });
    } else {
      context.config = Object.assign({}, config, {
        shareContentURL: buildShareUrl(articleId),
      });
    }

    // 分享前积分
    let energyBefore = null;
    try {
      const before = await getMyEnergy(context);
      energyBefore = extractPoint(before.payload);
    } catch (error) {
      // 积分查询失败不阻断分享
    }

    const shareCode = await obtainShareCode(context);
    await postShareReporting(context, shareCode);

    // 分享后积分对比（接口 success 不可信，以 point 变化为准）
    let energyAfter = null;
    try {
      const after = await getMyEnergy(context);
      energyAfter = extractPoint(after.payload);
    } catch (error) {
      // 忽略
    }

    report.energyBefore = energyBefore;
    report.energyAfter = energyAfter;

    if (energyBefore != null && energyAfter != null) {
      const delta = energyAfter - energyBefore;
      if (delta > 0) {
        report.share = { ok: true, points: delta };
        return { ok: true, points: delta };
      }
      report.share = { ok: true, already: true, points: 0 };
      return { ok: true, already: true, message: "no point change (already shared today?)" };
    }
    report.share = { ok: true, unverified: true };
    return { ok: true, unverified: true };
  } catch (error) {
    // 兜底文章重试
    if (config.fallbackArticleId && config.articleId !== config.fallbackArticleId) {
      try {
        context.config = Object.assign({}, context.config, {
          articleId: config.fallbackArticleId,
          shareContentURL: buildShareUrl(config.fallbackArticleId),
        });
        const shareCode = await obtainShareCode(context);
        await postShareReporting(context, shareCode);
        report.share = { ok: true, fallback: true };
        return { ok: true, fallback: true };
      } catch (fallbackError) {
        report.shareError = fallbackError;
        return { ok: false, message: fallbackError.message };
      }
    }
    report.shareError = error;
    return { ok: false, message: error.message };
  }
}

/* ---------------- 汇总 ---------------- */

function summarizeTask(name, result) {
  if (!result) return name + ": skipped";
  if (result.ok) {
    if (result.already) return name + ": ok (already)";
    if (result.points != null) return name + ": ok (+" + result.points + ")";
    return name + ": ok";
  }
  return name + ": failed (" + shorten(result.message) + ")";
}

function shorten(text) {
  const value = String(text || "");
  return value.length > 160 ? value.slice(0, 157) + "..." : value;
}

function buildSummary(report, config) {
  const parts = [summarizeTask("Sign", report.sign)];
  if (config.shareEnabled) parts.push(summarizeTask("Share", report.share));
  return parts.join(" | ");
}

/**
 * 每日主流程：续期 → 签到 → 分享 → 汇总
 * @returns {string} 摘要（用于通知）
 */
async function runDailyTasks(context) {
  const report = { sign: null, share: null };
  const config = context.config;

  // 1) 续期（失败不阻断，旧 token 可能仍可用）
  if (context.tokenState.refreshToken) {
    try {
      const refreshed = await refreshToken(context, context.tokenState.refreshToken);
      if (refreshed && refreshed.token) {
        context.tokenState = Object.assign({}, context.tokenState, refreshed);
        writeTokenState(context.store, context.tokenState);
      }
    } catch (error) {
      report.refreshError = error;
    }
  }

  // 2) 签到
  const signResult = await runSignTask(context, report);

  // 3) 分享
  let shareResult = null;
  if (config.shareEnabled) {
    shareResult = await runShareTask(context, report);
  }

  const summary = buildSummary(report, config);

  // 4) 诊断信息
  let diagnostic = "";
  if (config.debug) {
    const details = [];
    if (report.refreshError) {
      details.push("refresh=" + shorten(report.refreshError.message));
    }
    if (report.signError) {
      details.push("signErr=" + shorten(report.signError.message));
    }
    if (report.shareError) {
      details.push("shareErr=" + shorten(report.shareError.message));
    }
    if (report.energyBefore != null || report.energyAfter != null) {
      details.push("energy=" + report.energyBefore + "->" + report.energyAfter);
    }
    details.push("token=" + summarizeTokenState(context.tokenState));
    diagnostic = details.join(" | ");
  }
  report.summary = summary;

  return { summary, diagnostic, report };
}

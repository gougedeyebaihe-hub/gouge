const TOKEN_STATE_KEY = "lynkco.share.tokenState";

function parseArgumentString(argument) {
  if (!argument) return {};
  return argument
    .split("&")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((accumulator, entry) => {
      const parts = entry.split("=");
      const key = (parts.shift() || "").trim();
      if (!key) return accumulator;
      accumulator[key] = parts.join("=").trim();
      return accumulator;
    }, {});
}

function serializeTokenState(tokenState) {
  return JSON.stringify({
    token: tokenState.token || "",
    refreshToken: tokenState.refreshToken || "",
  });
}

function extractTokenState(request) {
  if (!request || !request.url) {
    return { token: "", refreshToken: "" };
  }
  const headers = request.headers || {};
  const token = headers.token || headers.Token || "";
  const url = new URL(request.url);
  const refreshToken = url.searchParams.get("refreshToken") || "";

  return { token, refreshToken };
}

function safeParseTokenState(raw) {
  if (!raw) return { token: "", refreshToken: "" };
  try {
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || "",
      refreshToken: parsed.refreshToken || "",
    };
  } catch (error) {
    return { token: "", refreshToken: "" };
  }
}

function parseJson(data) {
  if (!data || typeof data !== "string") return null;
  try {
    return JSON.parse(data);
  } catch (error) {
    return null;
  }
}

function findTokenState(value) {
  if (!value || typeof value !== "object") {
    return { token: "", refreshToken: "" };
  }

  const directToken = value.token || value.accessToken || "";
  const directRefreshToken = value.refreshToken || value.refresh_token || "";
  if (directToken || directRefreshToken) {
    return {
      token: directToken,
      refreshToken: directRefreshToken,
    };
  }

  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const nestedState = findTokenState(value[keys[index]]);
    if (nestedState.token || nestedState.refreshToken) {
      return nestedState;
    }
  }

  return { token: "", refreshToken: "" };
}

function extractBodyTokenState(body) {
  return findTokenState(parseJson(body));
}

function hasTokenState(tokenState) {
  return Boolean(tokenState.token || tokenState.refreshToken);
}

function mergeTokenState(previousState, nextState) {
  return {
    token: nextState.token || previousState.token || "",
    refreshToken: nextState.refreshToken || previousState.refreshToken || "",
  };
}

function writeTokenState(store, tokenState) {
  return store.write(serializeTokenState(tokenState), TOKEN_STATE_KEY);
}

function shouldNotifyForDebug(argument) {
  const value = parseArgumentString(argument).debugNotify;
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function runCapture(options = {}) {
  const request = options.request || $request;
  const response = options.response || (typeof $response === "undefined" ? null : $response);
  const store = options.store || $persistentStore;
  const notification = options.notification || $notification;
  const argument = options.argument || (typeof $argument === "undefined" ? "" : $argument);
  const done = options.done || $done;
  if (!request && !response) {
    done({});
    return;
  }

  const tokenState = mergeTokenState(
    mergeTokenState(extractTokenState(request), extractBodyTokenState(request && request.body)),
    extractBodyTokenState(response && response.body),
  );

  if (hasTokenState(tokenState)) {
    const previousTokenState = safeParseTokenState(store.read(TOKEN_STATE_KEY));
    writeTokenState(store, mergeTokenState(previousTokenState, tokenState));
    if (notification && shouldNotifyForDebug(argument)) {
      notification.post("Lynk & Co Share", "", "Captured Lynk & Co auth state.");
    }
  }

  done({});
}

runCapture();

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
    oauthAccessToken: tokenState.oauthAccessToken || "",
    oauthRefreshToken: tokenState.oauthRefreshToken || "",
    authorization: tokenState.authorization || "",
  });
}

function extractTokenState(request) {
  if (!request || !request.url) {
    return {
      token: "",
      refreshToken: "",
      oauthAccessToken: "",
      oauthRefreshToken: "",
      authorization: "",
    };
  }
  const headers = request.headers || {};
  const token = headers.token || headers.Token || "";
  const authorization = headers.authorization || headers.Authorization || "";
  const url = new URL(request.url);
  const refreshToken = url.searchParams.get("refreshToken") || "";

  return {
    token,
    refreshToken,
    oauthAccessToken: "",
    oauthRefreshToken: "",
    authorization,
  };
}

function safeParseTokenState(raw) {
  if (!raw) {
    return {
      token: "",
      refreshToken: "",
      oauthAccessToken: "",
      oauthRefreshToken: "",
      authorization: "",
    };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      token: parsed.token || "",
      refreshToken: parsed.refreshToken || "",
      oauthAccessToken: parsed.oauthAccessToken || "",
      oauthRefreshToken: parsed.oauthRefreshToken || "",
      authorization: parsed.authorization || "",
    };
  } catch (error) {
    return {
      token: "",
      refreshToken: "",
      oauthAccessToken: "",
      oauthRefreshToken: "",
      authorization: "",
    };
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

function emptyTokenState() {
  return {
    token: "",
    refreshToken: "",
    oauthAccessToken: "",
    oauthRefreshToken: "",
    authorization: "",
  };
}

function findTokenState(value, path = "") {
  if (!value || typeof value !== "object") {
    return emptyTokenState();
  }

  const currentPath = path.toLowerCase();
  const isOAuthContext = currentPath.includes("oauth");
  const isCenterContext = currentPath.includes("center");

  const directState = {
    token: "",
    refreshToken: "",
    oauthAccessToken:
      value.oauthAccessToken || value.accessToken || value.access_token || "",
    oauthRefreshToken:
      value.oauthRefreshToken || (isOAuthContext ? (value.refreshToken || value.refresh_token || "") : ""),
    authorization: value.authorization || value.Authorization || "",
  };

  if (isCenterContext) {
    directState.token = value.token || "";
    directState.refreshToken = value.refreshToken || value.refresh_token || "";
  } else if (!isOAuthContext) {
    directState.token = value.token || "";
    directState.refreshToken = value.refreshToken || value.refresh_token || "";
  }

  const keys = Object.keys(value);
  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const nestedPath = currentPath ? currentPath + "." + key : key;
    const nestedState = findTokenState(value[key], nestedPath);
    directState.token = directState.token || nestedState.token;
    directState.refreshToken = directState.refreshToken || nestedState.refreshToken;
    directState.oauthAccessToken =
      directState.oauthAccessToken || nestedState.oauthAccessToken;
    directState.oauthRefreshToken =
      directState.oauthRefreshToken || nestedState.oauthRefreshToken;
    directState.authorization = directState.authorization || nestedState.authorization;
  }

  return directState;
}

function extractBodyTokenState(body) {
  return findTokenState(parseJson(body));
}

function hasTokenState(tokenState) {
  return Boolean(
    tokenState.token ||
      tokenState.refreshToken ||
      tokenState.oauthAccessToken ||
      tokenState.oauthRefreshToken ||
      tokenState.authorization,
  );
}

function mergeTokenState(previousState, nextState) {
  return {
    token: nextState.token || previousState.token || "",
    refreshToken: nextState.refreshToken || previousState.refreshToken || "",
    oauthAccessToken:
      nextState.oauthAccessToken || previousState.oauthAccessToken || "",
    oauthRefreshToken:
      nextState.oauthRefreshToken || previousState.oauthRefreshToken || "",
    authorization: nextState.authorization || previousState.authorization || "",
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

function summarizeCapturedFields(tokenState) {
  return [
    tokenState.token ? "token" : "",
    tokenState.refreshToken ? "refreshToken" : "",
    tokenState.oauthAccessToken ? "oauthAccessToken" : "",
    tokenState.oauthRefreshToken ? "oauthRefreshToken" : "",
    tokenState.authorization ? "authorization" : "",
  ].filter(Boolean);
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
    const mergedTokenState = mergeTokenState(previousTokenState, tokenState);
    writeTokenState(store, mergedTokenState);
    if (notification && shouldNotifyForDebug(argument)) {
      notification.post(
        "Lynk & Co Share",
        "",
        "Captured Lynk & Co auth state: " + summarizeCapturedFields(mergedTokenState).join(", ") + ".",
      );
    }
  }

  done({});
}

runCapture();

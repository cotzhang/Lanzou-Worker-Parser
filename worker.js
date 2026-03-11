/**
 * @package Lanzou
 * @author Cotzhang
 * @version 1.0.0
 * @Date 2026.3.11
 * @link https://hanximeng.com
 *
 * Cloudflare Workers JavaScript 完整可运行版本
 * 功能说明：
 * 1. 解析蓝奏云/蓝奏·云存储分享链接
 * 2. 支持带密码/不带密码链接
 * 3. 支持 type=down 直接 302 跳转下载
 * 4. 支持 n 参数对下载后的文件后缀进行重命名适配
 *
 * 使用方式：
 *   GET /?url=分享链接
 *   GET /?url=分享链接&pwd=密码
 *   GET /?url=分享链接&type=down
 *   GET /?url=分享链接&n=apk
 */

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request);
    } catch (err) {
      return jsonResponse(
        {
          code: 500,
          msg: err && err.message ? err.message : "服务器内部错误",
        },
        500
      );
    }
  },
};

// 默认UA
const UserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36";

async function handleRequest(request) {
  const reqUrl = new URL(request.url);
  const url = reqUrl.searchParams.get("url") || "";
  const pwd = reqUrl.searchParams.get("pwd") || "";
  const type = reqUrl.searchParams.get("type") || "";
  const n = reqUrl.searchParams.get("n") || "";

  // 判断传入链接参数是否为空
  if (!url) {
    return jsonResponse(
      {
        code: 400,
        msg: "请输入URL",
      },
      400
    );
  }

  // 一个简单的链接处理
  const normalizedUrl = normalizeLanzouUrl(url);

  let softInfo = await MloocCurlGet(normalizedUrl);

  // 判断文件链接是否失效
  if (softInfo.includes("文件取消分享了")) {
    return jsonResponse(
      {
        code: 400,
        msg: "文件取消分享了",
      },
      400
    );
  }

  // 取文件名称、大小
  let softName = matchFirst(
    /style="font-size:\s*30px;text-align:\s*center;padding:\s*56px 0px 20px 0px;">(.*?)<\/div>/s,
    softInfo
  );
  if (!softName) {
    softName = matchFirst(/<div class="n_box_3fn".*?>(.*?)<\/div>/s, softInfo);
  }

  let softFilesize = matchFirst(
    /<div class="n_filesize".*?>大小：(.*?)<\/div>/s,
    softInfo
  );
  if (!softFilesize) {
    softFilesize = matchFirst(/<span class="p7">文件大小：<\/span>(.*?)<br>/s, softInfo);
  }

  if (!softName) {
    softName = matchFirst(/var filename = '(.*?)';/s, softInfo);
  }
  if (!softName) {
    softName = matchFirst(/div class="b"><span>(.*?)<\/span><\/div>/s, softInfo);
  }

  // 带密码的链接的处理
  if (softInfo.includes("function down_p(){")) {
    if (!pwd) {
      return jsonResponse(
        {
          code: 400,
          msg: "请输入分享密码",
        },
        400
      );
    }

    const segment = matchAllGroups(/'sign':'(.*?)',/gs, softInfo);
    const signs = matchAllGroups(/ajaxdata = '(.*?)'/gs, softInfo);
    const ajaxm = matchAllGroups(/ajaxm\.php\?file=(\d+)/g, softInfo);

    const actionSign =
      segment.length > 1 ? segment[1] : segment.length > 0 ? segment[0] : "";
    const ajaxmFullMatch = softInfo.match(/ajaxm\.php\?file=\d+/g);
    const ajaxmPath = ajaxmFullMatch && ajaxmFullMatch[0] ? ajaxmFullMatch[0] : "";

    const postData = {
      action: "downprocess",
      sign: actionSign,
      p: pwd,
      kd: "1",
    };

    softInfo = await MloocCurlPost(
      postData,
      "https://www.lanzouf.com/" + ajaxmPath,
      normalizedUrl
    );

    try {
      const tempObj = JSON.parse(softInfo);
      if (tempObj && typeof tempObj.inf !== "undefined") {
        softName = tempObj.inf;
      }
    } catch (_) {}
  } else {
    // 不带密码的链接处理
    let link = matchFirst(/\n<iframe.*?name="[\s\S]*?"\ssrc="\/(.*?)"/s, softInfo);

    // 蓝奏云新版页面正则规则
    if (!link) {
      link = matchFirst(/<iframe.*?name="[\s\S]*?"\ssrc="\/(.*?)"/s, softInfo);
    }

    const ifurl = "https://www.lanzouf.com/" + (link || "");
    softInfo = await MloocCurlGet(ifurl);

    const segment = matchAllGroups(/wp_sign = '(.*?)'/gs, softInfo);
    const signs = matchAllGroups(/ajaxdata = '(.*?)'/gs, softInfo);
    const ajaxmFullMatch = softInfo.match(/ajaxm\.php\?file=\d+/g);
    const ajaxmPath =
      ajaxmFullMatch && ajaxmFullMatch[1]
        ? ajaxmFullMatch[1]
        : ajaxmFullMatch && ajaxmFullMatch[0]
        ? ajaxmFullMatch[0]
        : "";

    const postData = {
      action: "downprocess",
      websignkey: signs[0] || "",
      signs: signs[0] || "",
      sign: segment[0] || "",
      websign: "",
      kd: "1",
      ves: "1",
    };

    softInfo = await MloocCurlPost(
      postData,
      "https://www.lanzouf.com/" + ajaxmPath,
      ifurl
    );
  }

  // 其他情况下的信息输出
  let softInfoObj;
  try {
    softInfoObj = JSON.parse(softInfo);
  } catch (_) {
    return jsonResponse(
      {
        code: 400,
        msg: "解析失败，返回数据不是有效JSON",
      },
      400
    );
  }

  if (softInfoObj.zt != 1) {
    return jsonResponse(
      {
        code: 400,
        msg: softInfoObj.inf || "解析失败",
      },
      400
    );
  }

  // 拼接链接
  const downUrl1 = softInfoObj.dom + "/file/" + softInfoObj.url;

  // cookie生成
  const downPageHtml = await MloocCurlGet(downUrl1);
  const arg = matchAllGroups(/arg1='(.*?)'/gs, downPageHtml);
  const decrypted = acw_sc_v2_simple(arg[0] || "");

  // 解析最终直链地址
  const downUrl2 = await MloocCurlHead(
    downUrl1,
    "https://developer.lanzoug.com",
    UserAgent,
    "down_ip=1; expires=Sat, 16-Nov-2019 11:42:54 GMT; path=/; domain=.baidupan.com;acw_sc__v2=" +
      decrypted
  );

  let downUrl = "";

  // 判断最终链接是否获取成功，如未成功则使用原链接
  if (!downUrl2 || !downUrl2.includes("http")) {
    downUrl = downUrl1;
  } else {
    // 2025-03-17 新增后缀自定义功能 https://github.com/hanximeng/LanzouAPI/issues/26
    // 根据用户提供的 Issue 内容：在链接参数中对下载后的文件进行重命名，针对部分改后缀的文件进行适配。
    if (n) {
      const renameMatch = downUrl2.match(/(.*?)\?fn=(.*?)\./);
      if (renameMatch && renameMatch[0]) {
        downUrl = renameMatch[0] + n;
      } else {
        downUrl = downUrl2;
      }
    } else {
      downUrl = downUrl2;
    }
  }

  // 2024-12-03 修复pid参数可能导致的服务器ip地址泄露
  downUrl = downUrl.replace(/pid=(.*?.)&/, "");

  // 判断是否是直接下载
  if (type !== "down") {
    return jsonResponse(
      {
        code: 200,
        msg: "解析成功",
        name: softName || "",
        filesize: softFilesize || "",
        downUrl: downUrl,
      },
      200
    );
  } else {
    return Response.redirect(downUrl, 302);
  }
}

// 获取下载链接函数
async function MloocCurlGetDownUrl(url) {
  const resp = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": UserAgent,
    },
  });

  const location = resp.headers.get("Location");
  if (location) {
    return location;
  }
  return "";
}

// GET函数
async function MloocCurlGet(url = "", userAgent = "") {
  const headers = new Headers();
  headers.set("X-FORWARDED-FOR", Rand_IP());
  headers.set("CLIENT-IP", Rand_IP());
  headers.set("Accept-Encoding", "gzip");
  if (userAgent) {
    headers.set("User-Agent", userAgent);
  } else {
    headers.set("User-Agent", UserAgent);
  }

  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
    cf: {
      cacheTtl: 0,
      cacheEverything: false,
    },
  });

  return await response.text();
}

// POST函数
async function MloocCurlPost(post_data = "", url = "", ifurl = "", userAgent = "") {
  const headers = new Headers();
  headers.set("X-FORWARDED-FOR", Rand_IP());
  headers.set("CLIENT-IP", Rand_IP());
  headers.set("User-Agent", userAgent || UserAgent);
  headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");

  if (ifurl) {
    headers.set("Referer", ifurl);
  }

  const body = new URLSearchParams();
  if (post_data && typeof post_data === "object") {
    for (const [key, value] of Object.entries(post_data)) {
      body.append(key, value == null ? "" : String(value));
    }
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    redirect: "follow",
    cf: {
      cacheTtl: 0,
      cacheEverything: false,
    },
  });

  return await response.text();
}

// 直链解析函数
async function MloocCurlHead(url, guise, userAgent, cookie) {
  const headers = new Headers();
  headers.set(
    "Accept",
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8"
  );
  headers.set("Accept-Encoding", "gzip, deflate");
  headers.set("Accept-Language", "zh-CN,zh;q=0.9");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  headers.set("Pragma", "no-cache");
  headers.set("Upgrade-Insecure-Requests", "1");
  headers.set("User-Agent", userAgent);
  headers.set("Referer", guise);
  headers.set("Cookie", cookie);

  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "manual",
    cf: {
      cacheTtl: 0,
      cacheEverything: false,
    },
  });

  const redirectUrl = response.headers.get("Location");
  return redirectUrl || "";
}

// 随机IP函数
function Rand_IP() {
  const ip2id = Math.round(randInt(600000, 2550000) / 10000);
  const ip3id = Math.round(randInt(600000, 2550000) / 10000);
  const ip4id = Math.round(randInt(600000, 2550000) / 10000);
  const arr_1 = [
    "218",
    "218",
    "66",
    "66",
    "218",
    "218",
    "60",
    "60",
    "202",
    "204",
    "66",
    "66",
    "66",
    "59",
    "61",
    "60",
    "222",
    "221",
    "66",
    "59",
    "60",
    "60",
    "66",
    "218",
    "218",
    "62",
    "63",
    "64",
    "66",
    "66",
    "122",
    "211",
  ];
  const randarr = randInt(0, arr_1.length - 1);
  const ip1id = arr_1[randarr];
  return ip1id + "." + ip2id + "." + ip3id + "." + ip4id;
}

// cookie生成函数
function acw_sc_v2_simple(arg1) {
  const posList = [
    15, 35, 29, 24, 33, 16, 1, 38, 10, 9,
    19, 31, 40, 27, 22, 23, 25, 13, 6, 11,
    39, 18, 20, 8, 14, 21, 32, 26, 2, 30,
    7, 4, 17, 5, 3, 28, 34, 37, 12, 36,
  ];
  const mask = "3000176000856006061501533003690027800375";
  const outPutList = new Array(40).fill("");

  for (let i = 0; i < arg1.length; i++) {
    const char = arg1[i];
    for (let j = 0; j < posList.length; j++) {
      const pos = posList[j];
      if (pos === i + 1) {
        outPutList[j] = char;
      }
    }
  }

  const arg2 = outPutList.join("");
  let result = "";
  const length = Math.min(arg2.length, mask.length);

  for (let i = 0; i < length; i += 2) {
    const strHex = arg2.substring(i, i + 2);
    const maskHex = mask.substring(i, i + 2);
    const xorResult = (parseInt(strHex, 16) ^ parseInt(maskHex, 16))
      .toString(16)
      .padStart(2, "0");
    result += xorResult;
  }

  return result;
}

function normalizeLanzouUrl(inputUrl) {
  const parts = inputUrl.split(".com/");
  if (parts.length > 1) {
    return "https://www.lanzouf.com/" + parts[1];
  }

  // 针对用户提供的“蓝奏·云存储 (https://www.lanzouf.com/)”域名也进行兼容
  try {
    const u = new URL(inputUrl);
    const path = u.pathname.replace(/^\/+/, "");
    const search = u.search || "";
    const hash = u.hash || "";
    return "https://www.lanzouf.com/" + path + search + hash;
  } catch (_) {
    return "https://www.lanzouf.com/" + String(inputUrl).replace(/^\/+/, "");
  }
}

function matchFirst(regex, text) {
  const m = text.match(regex);
  return m && typeof m[1] !== "undefined" ? m[1] : "";
}

function matchAllGroups(regex, text) {
  const arr = [];
  const matches = text.matchAll(regex);
  for (const m of matches) {
    if (typeof m[1] !== "undefined") {
      arr.push(m[1]);
    }
  }
  return arr;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

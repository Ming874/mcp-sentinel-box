/*
 * json_lite.c - 為 profile 載入提供的極簡 JSON 解析器
 *
 * 設計動機：
 *   - profile 採 JSON 格式（README 規範），但完整 JSON 函式庫（cJSON 等）
 *     會增加額外相依與編譯時間。本檔提供「夠用」的子集，避免 vendor 大檔。
 *   - 支援 object/array/string/number(整數與浮點)/bool/null。
 *   - 不支援 escape 之外的進階特性（unicode \uXXXX 簡化處理）；
 *     夠 profile 用即可，不打算做通用 JSON 函式庫。
 *
 * API：見檔尾 sb_json_parse / sb_json_get / sb_json_free。
 */

#define _GNU_SOURCE
#include "json_lite.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <errno.h>

/* ---------- 內部解析器狀態 ---------- */
typedef struct {
    const char *src;      /* 原始 JSON 字串起點 */
    const char *p;        /* 目前游標 */
    const char *end;      /* 終點 (src + len) */
    char        err[128]; /* 錯誤訊息 (供呼叫端參考) */
} jp_t;

/* 跳過空白，包含 JSON 標準的 0x20 0x09 0x0A 0x0D 四種 */
static void jp__skip_ws(jp_t *jp) {
    while (jp->p < jp->end) {
        char c = *jp->p;
        if (c == ' ' || c == '\t' || c == '\n' || c == '\r') jp->p++;
        else break;
    }
}

/* 設定錯誤訊息並回傳 NULL */
static sb_json_t *jp__err(jp_t *jp, const char *msg) {
    snprintf(jp->err, sizeof jp->err, "%s @offset=%ld", msg, (long)(jp->p - jp->src));
    return NULL;
}

/* 配置一個新的 node，type 與初值需呼叫端設定 */
static sb_json_t *jp__node(sb_json_type_t t) {
    sb_json_t *n = (sb_json_t *)calloc(1, sizeof *n);
    if (!n) return NULL;
    n->type = t;
    return n;
}

/* 解析字串：吃掉開頭 "，吃到下一個未跳脫的 "。回傳已分配的 C 字串。 */
static char *jp__parse_string(jp_t *jp) {
    if (jp->p >= jp->end || *jp->p != '"') { jp__err(jp, "expect string"); return NULL; }
    jp->p++; /* skip opening quote */
    const char *start = jp->p;
    /* 先快速掃過找結尾，量出長度好一次配置 */
    size_t worst = 0;
    const char *q = start;
    while (q < jp->end && *q != '"') {
        if (*q == '\\' && q + 1 < jp->end) q += 2;   /* 跳脫序列 */
        else q++;
        worst++;
    }
    if (q >= jp->end) { jp__err(jp, "unterminated string"); return NULL; }
    char *out = (char *)malloc(worst + 1);
    if (!out) return NULL;
    size_t oi = 0;
    /* 第二趟複製並處理跳脫 */
    while (jp->p < q) {
        char c = *jp->p++;
        if (c == '\\') {
            char e = *jp->p++;
            switch (e) {
                case '"': out[oi++] = '"'; break;
                case '\\': out[oi++] = '\\'; break;
                case '/': out[oi++] = '/'; break;
                case 'n': out[oi++] = '\n'; break;
                case 't': out[oi++] = '\t'; break;
                case 'r': out[oi++] = '\r'; break;
                case 'b': out[oi++] = '\b'; break;
                case 'f': out[oi++] = '\f'; break;
                case 'u':
                    /* 不解析 unicode escape，直接保留為佔位符 '?'，profile 不該用此特性 */
                    jp->p += 4; out[oi++] = '?'; break;
                default: out[oi++] = e; break;
            }
        } else {
            out[oi++] = c;
        }
    }
    out[oi] = '\0';
    jp->p = q + 1; /* skip closing quote */
    return out;
}

/* 前向宣告，object/array 會遞迴呼叫 */
static sb_json_t *jp__parse_value(jp_t *jp);

/* 解析 object: { "key": value, ... } */
static sb_json_t *jp__parse_object(jp_t *jp) {
    if (*jp->p != '{') return jp__err(jp, "expect {");
    jp->p++;
    sb_json_t *o = jp__node(SB_JSON_OBJECT);
    if (!o) return NULL;
    jp__skip_ws(jp);
    if (jp->p < jp->end && *jp->p == '}') { jp->p++; return o; }
    while (jp->p < jp->end) {
        jp__skip_ws(jp);
        char *key = jp__parse_string(jp);
        if (!key) { sb_json_free(o); return NULL; }
        jp__skip_ws(jp);
        if (jp->p >= jp->end || *jp->p != ':') { free(key); sb_json_free(o); return jp__err(jp, "expect :"); }
        jp->p++;
        jp__skip_ws(jp);
        sb_json_t *val = jp__parse_value(jp);
        if (!val) { free(key); sb_json_free(o); return NULL; }
        /* 將 key/val 串到 child linked list 尾端
         * 用 linked list 而非 array 是為了簡化動態長度管理；profile 不大，效能足夠 */
        sb_json_t *child = jp__node(SB_JSON_KEY);
        if (!child) { free(key); sb_json_free(val); sb_json_free(o); return NULL; }
        child->u.key.name = key;
        child->u.key.value = val;
        if (!o->u.obj.first) o->u.obj.first = child;
        else o->u.obj.last->next = child;
        o->u.obj.last = child;
        jp__skip_ws(jp);
        if (jp->p < jp->end && *jp->p == ',') { jp->p++; continue; }
        if (jp->p < jp->end && *jp->p == '}') { jp->p++; return o; }
        sb_json_free(o); return jp__err(jp, "expect , or }");
    }
    sb_json_free(o); return jp__err(jp, "unexpected eof in object");
}

/* 解析 array: [ value, ... ] */
static sb_json_t *jp__parse_array(jp_t *jp) {
    if (*jp->p != '[') return jp__err(jp, "expect [");
    jp->p++;
    sb_json_t *a = jp__node(SB_JSON_ARRAY);
    if (!a) return NULL;
    jp__skip_ws(jp);
    if (jp->p < jp->end && *jp->p == ']') { jp->p++; return a; }
    while (jp->p < jp->end) {
        jp__skip_ws(jp);
        sb_json_t *val = jp__parse_value(jp);
        if (!val) { sb_json_free(a); return NULL; }
        if (!a->u.arr.first) a->u.arr.first = val;
        else a->u.arr.last->next = val;
        a->u.arr.last = val;
        jp__skip_ws(jp);
        if (jp->p < jp->end && *jp->p == ',') { jp->p++; continue; }
        if (jp->p < jp->end && *jp->p == ']') { jp->p++; return a; }
        sb_json_free(a); return jp__err(jp, "expect , or ]");
    }
    sb_json_free(a); return jp__err(jp, "unexpected eof in array");
}

/* 解析數字：整數或浮點。用 strtod / strtoll 雙路探測。 */
static sb_json_t *jp__parse_number(jp_t *jp) {
    char *e1, *e2;
    /* 先試浮點，再判斷是否與整數一致 */
    double d = strtod(jp->p, &e1);
    if (e1 == jp->p) return jp__err(jp, "bad number");
    long long ll = strtoll(jp->p, &e2, 10);
    sb_json_t *n;
    /* 若兩種解析結果掃過長度相同，視為整數；否則視為浮點 */
    if (e1 == e2) {
        n = jp__node(SB_JSON_INT);
        if (!n) return NULL;
        n->u.i = ll;
    } else {
        n = jp__node(SB_JSON_NUM);
        if (!n) return NULL;
        n->u.f = d;
    }
    jp->p = e1;
    return n;
}

/* 解析單一值 (object / array / string / number / true / false / null) */
static sb_json_t *jp__parse_value(jp_t *jp) {
    jp__skip_ws(jp);
    if (jp->p >= jp->end) return jp__err(jp, "unexpected eof");
    char c = *jp->p;
    if (c == '{') return jp__parse_object(jp);
    if (c == '[') return jp__parse_array(jp);
    if (c == '"') {
        char *s = jp__parse_string(jp);
        if (!s) return NULL;
        sb_json_t *n = jp__node(SB_JSON_STR);
        if (!n) { free(s); return NULL; }
        n->u.s = s;
        return n;
    }
    /* 字面值 true / false / null */
    if (c == 't' && jp->end - jp->p >= 4 && memcmp(jp->p, "true", 4) == 0) {
        jp->p += 4;
        sb_json_t *n = jp__node(SB_JSON_BOOL); if (!n) return NULL;
        n->u.b = 1; return n;
    }
    if (c == 'f' && jp->end - jp->p >= 5 && memcmp(jp->p, "false", 5) == 0) {
        jp->p += 5;
        sb_json_t *n = jp__node(SB_JSON_BOOL); if (!n) return NULL;
        n->u.b = 0; return n;
    }
    if (c == 'n' && jp->end - jp->p >= 4 && memcmp(jp->p, "null", 4) == 0) {
        jp->p += 4;
        return jp__node(SB_JSON_NULL);
    }
    /* 否則嘗試當作數字 */
    if (c == '-' || (c >= '0' && c <= '9')) return jp__parse_number(jp);
    return jp__err(jp, "unexpected char");
}

/* ---------- 對外 API ---------- */

/* 將整個 JSON 字串解析為一棵 sb_json_t 樹。
 * 回傳 NULL 表失敗，呼叫端可用 sb_json_parse_err() 查錯誤原因（簡化版略）。 */
sb_json_t *sb_json_parse(const char *src, size_t len) {
    jp_t jp = { .src = src, .p = src, .end = src + len };
    sb_json_t *root = jp__parse_value(&jp);
    if (!root) {
        fprintf(stderr, "[json_lite] parse error: %s\n", jp.err);
        return NULL;
    }
    return root;
}

/* 釋放 JSON 樹；遞迴釋放所有 child */
void sb_json_free(sb_json_t *n) {
    if (!n) return;
    switch (n->type) {
        case SB_JSON_OBJECT: {
            sb_json_t *cur = n->u.obj.first;
            while (cur) { sb_json_t *nxt = cur->next; sb_json_free(cur); cur = nxt; }
            break;
        }
        case SB_JSON_ARRAY: {
            sb_json_t *cur = n->u.arr.first;
            while (cur) { sb_json_t *nxt = cur->next; sb_json_free(cur); cur = nxt; }
            break;
        }
        case SB_JSON_KEY:
            free(n->u.key.name);
            sb_json_free(n->u.key.value);
            break;
        case SB_JSON_STR: free(n->u.s); break;
        default: break;
    }
    free(n);
}

/* 在 object 中以 key 取值；找不到回 NULL */
const sb_json_t *sb_json_get(const sb_json_t *obj, const char *key) {
    if (!obj || obj->type != SB_JSON_OBJECT) return NULL;
    for (sb_json_t *c = obj->u.obj.first; c; c = c->next) {
        if (c->type == SB_JSON_KEY && strcmp(c->u.key.name, key) == 0) return c->u.key.value;
    }
    return NULL;
}

/* array 遍歷輔助 */
const sb_json_t *sb_json_array_first(const sb_json_t *arr) {
    if (!arr || arr->type != SB_JSON_ARRAY) return NULL;
    return arr->u.arr.first;
}

/* 數值/字串/布林取值的便利函式（型別不符回傳預設值） */
long long sb_json_as_int(const sb_json_t *n, long long defv) {
    if (!n) return defv;
    if (n->type == SB_JSON_INT) return n->u.i;
    if (n->type == SB_JSON_NUM) return (long long)n->u.f;
    return defv;
}
const char *sb_json_as_str(const sb_json_t *n, const char *defv) {
    if (!n || n->type != SB_JSON_STR) return defv;
    return n->u.s;
}
int sb_json_as_bool(const sb_json_t *n, int defv) {
    if (!n) return defv;
    if (n->type == SB_JSON_BOOL) return n->u.b;
    if (n->type == SB_JSON_INT)  return n->u.i != 0;
    return defv;
}

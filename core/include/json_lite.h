/*
 * json_lite.h - 對外公開的極簡 JSON 樹型別與 API
 *
 * 設計：
 *   - 以聯合 (union) 配合 type tag 表示 object/array/string/number/bool/null。
 *   - object 與 array 內部以 linked list 串接 child，避免動態 realloc。
 *   - "KEY" 是 internal 型別，僅作為 object 內 child 的容器。
 */

#ifndef JSON_LITE_H
#define JSON_LITE_H

#include <stddef.h>

typedef enum {
    SB_JSON_NULL = 0,
    SB_JSON_BOOL,
    SB_JSON_INT,
    SB_JSON_NUM,
    SB_JSON_STR,
    SB_JSON_ARRAY,
    SB_JSON_OBJECT,
    SB_JSON_KEY     /* internal: object 內的 key/value pair container */
} sb_json_type_t;

typedef struct sb_json_t {
    sb_json_type_t       type;
    struct sb_json_t    *next;       /* 同層 sibling，用於 object / array 的 child list */
    union {
        int                  b;       /* BOOL */
        long long            i;       /* INT */
        double               f;       /* NUM (浮點) */
        char                *s;       /* STR (擁有所有權) */
        struct {
            struct sb_json_t *first;
            struct sb_json_t *last;
        } arr;
        struct {
            struct sb_json_t *first;
            struct sb_json_t *last;
        } obj;
        struct {
            char                *name;     /* KEY 名稱 */
            struct sb_json_t    *value;    /* KEY 對應的 value */
        } key;
    } u;
} sb_json_t;

sb_json_t       *sb_json_parse(const char *src, size_t len);
void             sb_json_free(sb_json_t *n);
const sb_json_t *sb_json_get(const sb_json_t *obj, const char *key);
const sb_json_t *sb_json_array_first(const sb_json_t *arr);
long long        sb_json_as_int(const sb_json_t *n, long long defv);
const char      *sb_json_as_str(const sb_json_t *n, const char *defv);
int              sb_json_as_bool(const sb_json_t *n, int defv);

#endif

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main() {
    printf("--- Memory Bomb Starting ---\n");
    printf("Allocating memory until OOM...\n");
    
    size_t chunk = 10 * 1024 * 1024; // 10MB chunks
    void *last = NULL;
    while(1) {
        void *p = malloc(chunk);
        if (p) {
            memset(p, 0x41, chunk); // Touch memory to ensure physical allocation
            printf("Allocated: %p\n", p);
        } else {
            perror("malloc");
            break;
        }
    }
    return 0;
}

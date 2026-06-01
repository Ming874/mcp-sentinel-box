#include <stdio.h>
#include <unistd.h>

int main() {
    printf("--- Sandbox Infinite Loop Demo ---\n");
    printf("This process will run forever and consume CPU.\n");
    printf("You can kill it using the [Trash] icon in the stats panel.\n");
    
    while(1) {
        // Intensive calculation
        volatile int x = 1 + 1;
    }
    return 0;
}

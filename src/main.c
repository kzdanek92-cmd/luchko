/*
 * Brother-inspired top-down shooter prototype for DOS (Mode 13h)
 * Build with OpenWatcom inside DOSBox:
 *   wcl -fe=brother.exe src/main.c
 */
#include <dos.h>
#include <conio.h>
#include <stdlib.h>

#define SCREEN_WIDTH 320
#define SCREEN_HEIGHT 200
#define VIDEO_SEGMENT 0xA000

typedef struct {
    int x;
    int y;
    unsigned char color;
    int size;
} Sprite;

/* Direct pixel plot in Mode 13h */
void put_pixel(int x, int y, unsigned char color) {
    if (x < 0 || x >= SCREEN_WIDTH || y < 0 || y >= SCREEN_HEIGHT) {
        return;
    }
    unsigned char far *vram = (unsigned char far *)MK_FP(VIDEO_SEGMENT, 0);
    vram[y * SCREEN_WIDTH + x] = color;
}

void clear_screen(unsigned char color) {
    unsigned char far *vram = (unsigned char far *)MK_FP(VIDEO_SEGMENT, 0);
    for (int i = 0; i < SCREEN_WIDTH * SCREEN_HEIGHT; ++i) {
        vram[i] = color;
    }
}

void draw_box(Sprite sprite) {
    int half = sprite.size / 2;
    for (int y = -half; y <= half; ++y) {
        for (int x = -half; x <= half; ++x) {
            put_pixel(sprite.x + x, sprite.y + y, sprite.color);
        }
    }
}

void set_video_mode(unsigned char mode) {
    union REGS regs;
    regs.h.ah = 0x00;
    regs.h.al = mode;
    int86(0x10, &regs, &regs);
}

void draw_crosshair(Sprite player) {
    /* Draw a simple crosshair instead of a filled box */
    for (int dx = -player.size; dx <= player.size; ++dx) {
        put_pixel(player.x + dx, player.y, player.color);
    }
    for (int dy = -player.size; dy <= player.size; ++dy) {
        put_pixel(player.x, player.y + dy, player.color);
    }
    put_pixel(player.x, player.y, 15); /* white center */
}

void draw_world(void) {
    /* Placeholder for tiles/streets; draw a simple road stripe */
    for (int y = 0; y < SCREEN_HEIGHT; ++y) {
        put_pixel(SCREEN_WIDTH / 2, y, 8);
    }
}

int main(void) {
    Sprite player = {SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, 12, 6}; /* orange */

    set_video_mode(0x13); /* 320x200x256 */

    int running = 1;
    while (running) {
        clear_screen(0);       /* black background */
        draw_world();          /* placeholder backdrop */
        draw_crosshair(player);

        if (kbhit()) {
            int ch = getch();
            if (ch == 0 || ch == 0xE0) {
                /* arrow keys return 0/0xE0 then scancode */
                int code = getch();
                switch (code) {
                    case 72: player.y -= 3; break; /* Up */
                    case 80: player.y += 3; break; /* Down */
                    case 75: player.x -= 3; break; /* Left */
                    case 77: player.x += 3; break; /* Right */
                }
            } else {
                switch (ch) {
                    case 'w': case 'W': player.y -= 3; break;
                    case 's': case 'S': player.y += 3; break;
                    case 'a': case 'A': player.x -= 3; break;
                    case 'd': case 'D': player.x += 3; break;
                    case 27: running = 0; break; /* Esc */
                    default: break;
                }
            }
        }

        /* Simple bounds clamp */
        if (player.x < 4) player.x = 4;
        if (player.y < 4) player.y = 4;
        if (player.x > SCREEN_WIDTH - 5) player.x = SCREEN_WIDTH - 5;
        if (player.y > SCREEN_HEIGHT - 5) player.y = SCREEN_HEIGHT - 5;

        delay(16); /* ~60 FPS in DOS */
    }

    set_video_mode(0x03); /* text mode */
    return EXIT_SUCCESS;
}

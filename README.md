# DOS "Brother"-inspired Top-Down Shooter

This repository contains a tiny proof-of-concept for a DOS-era top-down shooter inspired by the movies **Брат** and **Брат 2**. The goal is to run in DOSBox with a 320×200 Mode 13h display, keyboard controls, and simple sprite rendering that can be expanded into a larger game loop.

## What is included
- `src/main.c`: Minimal Mode 13h example that draws the player, handles keyboard movement, and sketches how to extend with enemies and soundtrack triggers.
- `dosbox.conf`: A starter DOSBox configuration that mounts the build folder and runs the demo automatically.

## Building inside DOSBox
1. Install [DOSBox](https://www.dosbox.com/).
2. Copy the repository into a folder accessible to DOSBox (e.g., `~/dos/brother` on Linux or `C:\dos\brother` on Windows).
3. Launch DOSBox with the provided configuration:
   ```bash
   dosbox -conf dosbox.conf
   ```
4. Once DOSBox starts, it will mount the project as drive `C:`. Build the demo with OpenWatcom (already configured in `dosbox.conf`):
   ```
   wcl -fe=brother.exe src/main.c
   brother.exe
   ```

### Controls
- **Arrow keys / WASD**: Move the player crosshair.
- **Esc**: Quit the demo.

## How the code works
- Switches to VGA Mode 13h (320×200, 256 colors) via BIOS interrupt `0x10`.
- Uses direct writes to `0xA000` video memory for pixel drawing.
- Implements a simple fixed-timestep game loop with keyboard polling.
- Demonstrates sprite drawing, simple clipping, and color palette usage.

## Extending the prototype
- **Background**: Add tile-based maps and collision checks in `draw_world`.
- **Enemies**: Track enemy positions in arrays, reuse `draw_box` for sprites, and implement simple AI movement toward the player.
- **Audio**: Hook up `.MOD`/`.XM` playback using a DOS tracker library (e.g., [MPXPlay](https://mpxplay.sourceforge.net/)) to feature Nautilus Pompilius tracks.
- **Weapons**: Add a `bullet` struct and integrate fire controls with collision tests against enemies.
- **Menus**: Implement a title screen and options for soundtrack toggles.

## Notes
- The sample focuses on clarity over performance; DOSBox easily handles the per-frame clears for this small demo.
- If building with another compiler (e.g., Turbo C), adjust the includes and `delay` function as needed.

## Краткое описание по-русски
Это небольшой прототип шутера с видом сверху для DOS, вдохновлённый фильмами «Брат» и «Брат 2». Он работает в графическом режиме VGA 320×200 (Mode 13h) и использует прямую запись в видеопамять. В репозитории есть три основных файла:

- `src/main.c` — минимальный пример, где переключаем видеорежим, рисуем прицел игрока, обрабатываем клавиши и показываем, как расширить код под врагов и события со звуком.
- `dosbox.conf` — пример конфигурации DOSBox: монтирует проект как диск `C:`, включает OpenWatcom и автоматически запускает сборку и демонстрацию.
- `README.md` — общее описание проекта и шагов сборки.

### Как собрать и запустить в DOSBox
1. Установите DOSBox.
2. Скопируйте репозиторий в каталог, доступный DOSBox (например, `~/dos/brother` или `C:\\dos\\brother`).
3. Запустите DOSBox с конфигом из репозитория:
   ```bash
   dosbox -conf dosbox.conf
   ```
4. После старта DOSBox смонтирует проект как `C:`. Соберите и запустите демо:
   ```
   wcl -fe=brother.exe src/main.c
   brother.exe
   ```

### Управление
- Стрелки или WASD — движение прицела.
- Esc — выход из демо.

### Что можно улучшить дальше
- Добавить тайловый фон и коллизии в `draw_world`.
- Завести массивы врагов и использовать `draw_box` для их спрайтов, дописать простое преследование игрока.
- Подключить воспроизведение треков `.MOD`/`.XM`, чтобы сыграть саундтрек Nautilus Pompilius.
- Реализовать оружие, пули и проверки столкновений.
- Сделать титульный экран и меню для выбора треков.

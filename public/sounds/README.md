# Sonidos de la app

Subí acá los archivos de sonido. **Drop-and-go**: el código los detecta solo, no
hay que tocar nada. Si un sonido no tiene archivo, se usa el sintetizado (Web
Audio) como fallback.

## Convención

- **Formato:** `.mp3` (el más compatible — anda en iOS/Android/desktop).
- **Nombre del archivo = el "kind" del sonido.** Poné exactamente:

| Archivo                 | Cuándo suena                                       |
|-------------------------|----------------------------------------------------|
| `public/sounds/success.mp3` | Acción confirmada (publicar OK, activar algo)  |
| `public/sounds/win.mp3`     | Ganar una subasta / publicar (fanfarria)       |
| `public/sounds/pop.mp3`     | Puja registrada / pull-to-refresh              |
| `public/sounds/outbid.mp3`  | Te superaron la oferta                          |
| `public/sounds/tick.mp3`    | Tic del countdown (últimos 10s de subasta)     |
| `public/sounds/chime.mp3`   | Notificación entrante                           |

## Recomendaciones

- **Cortos** (< 1s la mayoría; la fanfarria de `win` puede ser ~1,5s).
- **Livianos** (< 50 KB ideal): exportá a mono, 96–128 kbps.
- Fuentes libres: mixkit.co, pixabay.com/sound-effects, freesound.org.
- Quedan **cacheados offline** por el service worker (ver `vite.config.ts`,
  `globPatterns` incluye `mp3`).

Subís el archivo con el nombre correcto, deployás, y el sonido real reemplaza al
sintetizado automáticamente. Si querés volver al sintetizado, borrá el archivo.

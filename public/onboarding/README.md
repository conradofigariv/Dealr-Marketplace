# Fotos de fondo del onboarding

Poné acá las 3 fotos de fondo de las pantallas de bienvenida (`IntroSlides`).

- **Formato:** vertical (portrait), tipo `1080 × 1920` o similar (relación 9:16).
- **Peso:** comprimidas (< 300 KB c/u idealmente) para que el onboarding cargue rápido.
- **Estilo:** que el grueso del interés quede en la mitad de arriba — abajo va un
  degradado oscuro con el texto, así que esa zona se tapa.

Nombres EXACTOS (los usa `src/components/IntroSlides.tsx`):

| Archivo | Pantalla | Idea de foto |
|---------|----------|--------------|
| `1.jpg` | "Un marketplace seguro" | Personas reales / un apretón de manos / alguien con su DNI; transmite confianza. |
| `2.jpg` | "Comprá y vendé a tu manera" | Una feria/mercado de usados, objetos lindos, una entrega en mano. |
| `3.jpg` | "Descubrí cerca tuyo" | Una vista de Córdoba / un mapa con pines / un barrio reconocible. |

Si falta alguna, esa pantalla cae a un degradado de color (queda prolijo igual),
así que podés ir agregándolas de a una.

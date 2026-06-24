-- 00027: la conversación sobrevive al borrado de la publicación.
--
-- Hasta ahora `conversations.listing_id` tenía `on delete cascade`: al borrar
-- una publicación, Postgres borraba en cascada todas sus conversaciones (y con
-- ellas los `messages`). Resultado: el vendedor perdía el historial de chat con
-- compradores apenas eliminaba el producto.
--
-- Cambiamos la FK a `on delete set null` y hacemos `listing_id` nullable: al
-- borrar la publicación, la conversación queda con `listing_id = null` ("Publicación
-- eliminada" en el front) pero conserva los mensajes. El resto del contenido
-- atado a la publicación (preguntas, ofertas, pujas) sigue cayendo por su propio
-- cascade —eso es lo deseado—, solo el chat persiste.

alter table public.conversations
  drop constraint conversations_listing_id_fkey;

alter table public.conversations
  alter column listing_id drop not null;

alter table public.conversations
  add constraint conversations_listing_id_fkey
  foreign key (listing_id) references public.listings (id) on delete set null;

-- Nota sobre el unique (listing_id, buyer_id): en Postgres los NULL son
-- distintos entre sí, así que varias conversaciones "huérfanas" del mismo
-- comprador no colisionan. No hay que tocarlo.

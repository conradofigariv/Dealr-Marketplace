import { useState } from 'react'

// Modal de Términos y Condiciones, bloqueante, en el primer ingreso (antes de
// usar la app). No se cierra tocando afuera: solo con los botones del footer.
// Adaptado al design system oscuro de Dealr (no Shadcn / no tema claro).

type Block = { p: string } | { ul: string[] }
interface Section {
  title: string
  blocks: Block[]
}

const SECTIONS: Section[] = [
  {
    title: '1 — Introducción y Aceptación',
    blocks: [
      { p: 'Estos Términos y Condiciones (en adelante, los “Términos”) regulan el acceso y uso de la plataforma Dealr (en adelante, “Dealr”, “la Plataforma”, “nosotros”), un marketplace local de compra y venta entre particulares operado en la ciudad de Córdoba, Argentina.' },
      { p: 'Al registrarte, acceder o utilizar Dealr de cualquier forma, aceptás estos Términos en su totalidad. Si no estás de acuerdo con alguna disposición, no debés utilizar la Plataforma.' },
      { p: 'Dealr se reserva el derecho de modificar estos Términos en cualquier momento. Los cambios serán notificados a través de la Plataforma y entrarán en vigencia desde su publicación. El uso continuado de Dealr luego de una modificación implica la aceptación de los nuevos Términos.' },
    ],
  },
  {
    title: '2 — Definiciones',
    blocks: [
      {
        ul: [
          '“Usuario”: toda persona física que se registra y utiliza Dealr, ya sea como comprador, vendedor, o ambos.',
          '“Vendedor”: Usuario que publica uno o más productos para su venta a través de la Plataforma.',
          '“Comprador”: Usuario que contacta a un Vendedor con intención de adquirir un producto publicado.',
          '“Publicación” o “Listing”: anuncio de un producto creado por un Vendedor, incluyendo fotos, descripción, precio y ubicación.',
          '“Transacción”: acuerdo de compraventa alcanzado entre un Comprador y un Vendedor a través de Dealr.',
          '“Reputación”: puntaje numérico asignado a cada Usuario en base a su comportamiento dentro de la Plataforma, según el sistema descripto en la Sección 6.',
        ],
      },
    ],
  },
  {
    title: '3 — Naturaleza del Servicio',
    blocks: [
      { p: 'Dealr es un intermediario tecnológico que facilita el contacto entre personas interesadas en comprar y vender productos de segunda mano o nuevos dentro de un ámbito geográfico local. Dealr no es propietario de los productos publicados, no participa en la fijación de precios, no garantiza la calidad, legalidad, autenticidad o estado de los productos, y no es parte de la relación contractual de compraventa que se celebra entre Comprador y Vendedor.' },
      { p: 'Dealr actúa exclusivamente como plataforma tecnológica. La responsabilidad por el cumplimiento de las obligaciones derivadas de cada Transacción recae exclusivamente en el Comprador y el Vendedor involucrados.' },
    ],
  },
  {
    title: '4 — Registro y Cuenta de Usuario',
    blocks: [
      { p: '4.1 Requisitos. Para utilizar Dealr es necesario registrarse mediante correo electrónico (enlace de acceso) o autenticación con cuenta de Google. El Usuario debe ser mayor de 18 años. La verificación de identidad se realiza a través de un proveedor externo que valida la edad; si la validación indica que el Usuario es menor de 18 años, su cuenta queda con funciones restringidas.' },
      { p: '4.2 Veracidad de los datos. El Usuario se compromete a proporcionar información veraz, completa y actualizada al momento de registrarse, y a mantenerla actualizada. La provisión de información falsa puede resultar en la suspensión o eliminación de la cuenta.' },
      { p: '4.3 Verificación de identidad. Dealr ofrece un mecanismo opcional de verificación de identidad mediante documento nacional de identidad (DNI). La verificación otorga al Usuario una insignia visible (“Identidad verificada”) y puntos adicionales de reputación. La verificación no constituye una garantía absoluta de la identidad del Usuario ni exime de responsabilidad a Dealr ni al Usuario verificado.' },
      { p: '4.4 Responsabilidad de la cuenta. El Usuario es responsable de mantener la confidencialidad de sus credenciales de acceso y de toda actividad realizada desde su cuenta. Dealr no se responsabiliza por accesos no autorizados derivados de la negligencia del Usuario en la custodia de sus credenciales.' },
    ],
  },
  {
    title: '5 — Publicaciones de Productos',
    blocks: [
      { p: '5.1 Contenido permitido. Los Vendedores pueden publicar productos nuevos o usados, acompañados de hasta seis fotos, descripción, precio, categoría, condición y ubicación.' },
      { p: '5.2 Veracidad de las publicaciones. El Vendedor garantiza que las fotos corresponden al producto real ofrecido, que la descripción es precisa, y que el producto se encuentra legalmente en su posesión y disponible para la venta.' },
      { p: '5.3 Productos prohibidos. Queda terminantemente prohibido publicar:' },
      {
        ul: [
          'Armas de fuego, municiones o explosivos',
          'Sustancias estupefacientes o psicotrópicas',
          'Animales vivos',
          'Medicamentos sin prescripción o de venta restringida',
          'Productos robados o de origen ilícito',
          'Bienes falsificados o que infrinjan derechos de propiedad intelectual',
          'Contenido sexual, pornográfico o servicios de naturaleza sexual',
          'Cualquier bien o servicio cuya comercialización esté prohibida por la legislación argentina vigente',
        ],
      },
      { p: '5.4 Ubicación del producto. Por privacidad, la Plataforma nunca muestra el punto exacto: solo un área aproximada alrededor de la ubicación cargada por el Vendedor. La dirección exacta se coordina entre las partes dentro del chat de la Plataforma.' },
      { p: '5.5 Moderación. Dealr se reserva el derecho de remover cualquier Publicación que infrinja estos Términos, sin necesidad de aviso previo, y de suspender o eliminar la cuenta del Usuario responsable.' },
    ],
  },
  {
    title: '6 — Reputación y Calificaciones',
    blocks: [
      { p: 'Dealr cuenta con un sistema de reputación basado en las calificaciones que los Usuarios se dan entre sí al concretar operaciones. Cada Usuario puede tener un puntaje como vendedor y como comprador, expresado en estrellas (de 1 a 5), calculado como el promedio de las calificaciones recibidas.' },
      { p: 'Las calificaciones son “ciegas”: la calificación que un Usuario recibe permanece oculta hasta que ambas partes hayan calificado, o hasta que transcurra un plazo desde la calificación. Esto evita represalias y fomenta calificaciones honestas.' },
      { p: 'Hasta contar con un mínimo de calificaciones, el Usuario se muestra como “Usuario nuevo”. La verificación de identidad otorga además una insignia visible de “Identidad verificada”.' },
      { p: 'Dealr no garantiza que la reputación refleje con exactitud el comportamiento real de cada Usuario en todas las circunstancias, y recomienda a los Usuarios actuar siempre con prudencia razonable al concretar una Transacción.' },
    ],
  },
  {
    title: '7 — Mensajería y Comunicación',
    blocks: [
      { p: 'Toda comunicación entre Comprador y Vendedor relacionada con una Publicación debe realizarse a través del chat interno de Dealr. Los Usuarios pueden editar o eliminar sus propios mensajes; Dealr puede conservar registros con el fin de moderación y de resolver eventuales disputas.' },
      { p: 'Las publicaciones que llevan mucho tiempo sin renovarse se pausan automáticamente para mantener el catálogo actualizado.' },
      { p: 'Queda prohibido el uso del chat para fines distintos a la negociación de una Transacción, incluyendo el envío de spam, contenido ofensivo, discriminatorio o ilegal.' },
    ],
  },
  {
    title: '8 — Pagos y Transacciones',
    blocks: [
      { p: 'Dealr no procesa, retiene ni intermedia en ningún pago entre Usuarios. Todo acuerdo económico, forma de pago, monto y condiciones de la Transacción son negociados y ejecutados directamente entre Comprador y Vendedor, por fuera de la Plataforma.' },
      { p: 'Dealr recomienda a los Usuarios extremar precauciones al realizar pagos, priorizando modalidades seguras (pago contra entrega, verificación del producto antes de pagar) y desconfiando de solicitudes de pago anticipado a Usuarios sin historial de reputación.' },
      { p: 'Dealr no es responsable por pérdidas económicas derivadas de pagos realizados entre Usuarios fuera de la Plataforma.' },
    ],
  },
  {
    title: '9 — Reseñas y Calificaciones',
    blocks: [
      { p: 'Al concretar una operación, ambas partes pueden dejarse una calificación de 1 a 5 estrellas y un comentario. Las calificaciones son ciegas hasta que ambas partes califican (o hasta vencer el plazo), y una vez reveladas son públicas y no pueden ser eliminadas por el Usuario que las recibe.' },
      { p: 'Está prohibido publicar calificaciones falsas, difamatorias o que no correspondan a una operación real ocurrida dentro de la Plataforma. Dealr se reserva el derecho de eliminar calificaciones que infrinjan esta disposición.' },
    ],
  },
  {
    title: '10 — Denuncias y Bloqueo de Usuarios',
    blocks: [
      { p: 'Los Usuarios pueden denunciar Publicaciones o perfiles que consideren fraudulentos, engañosos o que infrinjan estos Términos, seleccionando un motivo entre las categorías disponibles en la Plataforma (producto falso, precio irreal, foto robada, spam, estafa u otro).' },
      { p: 'Dealr revisará cada denuncia y podrá aplicar las medidas que considere apropiadas, incluyendo la suspensión temporal o permanente de la cuenta denunciada. Asimismo, los Usuarios pueden bloquear a otros Usuarios para impedir cualquier tipo de contacto futuro dentro de la Plataforma.' },
    ],
  },
  {
    title: '11 — Entrega y Logística',
    blocks: [
      { p: 'Dealr no presta servicios de envío ni logística. El Vendedor puede indicar en su Publicación si acepta envío. La coordinación, el costo y la ejecución de la entrega son responsabilidad exclusiva de las partes involucradas en la Transacción.' },
      { p: 'Dealr recomienda a los Usuarios que opten por encuentros en persona realizar dicho encuentro en lugares públicos y concurridos, y verificar el producto antes de pagar.' },
    ],
  },
  {
    title: '12 — Limitación de Responsabilidad',
    blocks: [
      { p: 'En la máxima medida permitida por la legislación argentina aplicable, Dealr no será responsable por:' },
      {
        ul: [
          'La calidad, estado, legalidad o autenticidad de los productos publicados por los Vendedores',
          'El incumplimiento de cualquiera de las partes respecto de las obligaciones asumidas en una Transacción',
          'Daños, pérdidas o perjuicios derivados de encuentros presenciales entre Usuarios',
          'La exactitud de la información de reputación, verificación o reseñas, en la medida en que estas reflejan información proporcionada por terceros',
          'Interrupciones, fallas técnicas o indisponibilidad temporal de la Plataforma',
        ],
      },
      { p: 'Dealr no garantiza que la Plataforma esté libre de errores o que su funcionamiento sea ininterrumpido, y realizará esfuerzos razonables para mantener su disponibilidad y seguridad.' },
    ],
  },
  {
    title: '13 — Propiedad Intelectual',
    blocks: [
      { p: 'El nombre “Dealr”, su logotipo, diseño, interfaz y demás elementos distintivos son propiedad de Dealr. Queda prohibida su reproducción, copia o uso sin autorización expresa.' },
      { p: 'Los Usuarios conservan los derechos sobre el contenido (fotos, descripciones) que suban a sus Publicaciones, pero otorgan a Dealr una licencia no exclusiva para mostrar dicho contenido dentro de la Plataforma con fines de operación del servicio.' },
    ],
  },
  {
    title: '14 — Suspensión y Baja de Cuenta',
    blocks: [
      { p: 'Dealr podrá suspender o dar de baja, de forma temporal o permanente, la cuenta de cualquier Usuario que infrinja estos Términos, sin perjuicio de las acciones legales que pudieran corresponder. Asimismo, todo Usuario podrá solicitar la baja de su cuenta en cualquier momento a través de la configuración de su perfil.' },
    ],
  },
  {
    title: '15 — Fuerza Mayor',
    blocks: [
      { p: 'Dealr no será responsable por incumplimientos o retrasos en la prestación del servicio derivados de causas ajenas a su control razonable, incluyendo pero no limitado a: fallas en servicios de terceros (proveedores de hosting, autenticación o conectividad), desastres naturales, cortes masivos de energía o de internet, actos de gobierno, pandemias, conflictos sociales o cualquier otro evento de fuerza mayor o caso fortuito.' },
    ],
  },
  {
    title: '16 — Cesión de la Plataforma',
    blocks: [
      { p: 'Dealr podrá ceder, transferir o transmitir la titularidad de la Plataforma, total o parcialmente, a un tercero, ya sea por venta, fusión, adquisición o cualquier otra operación societaria, sin necesidad de consentimiento previo de los Usuarios. En tal caso, los presentes Términos continuarán vigentes y serán asumidos por el nuevo titular, quien deberá notificar dicha cesión a los Usuarios a través de la Plataforma.' },
    ],
  },
  {
    title: '17 — Ley Aplicable y Jurisdicción',
    blocks: [
      { p: 'Estos Términos se rigen por las leyes de la República Argentina. Para cualquier controversia derivada del uso de la Plataforma, las partes se someten a la jurisdicción de los tribunales ordinarios de la ciudad de Córdoba, Argentina, con renuncia expresa a cualquier otro fuero que pudiera corresponder.' },
      { p: 'En lo aplicable, las relaciones de consumo dentro de la Plataforma se rigen además por la Ley N° 24.240 de Defensa del Consumidor y normativa concordante.' },
    ],
  },
  {
    title: '18 — Contacto',
    blocks: [
      { p: 'Ante consultas, dudas o reclamos relacionados con estos Términos, los Usuarios pueden contactarse a través de los canales de soporte disponibles dentro de la Plataforma.' },
    ],
  },
]

export default function TermsModal({
  onAccept,
  onReject,
  viewOnly = false,
}: {
  // En modo lectura (viewOnly, desde Configuración) no hay aceptar/rechazar:
  // onReject hace de "cerrar" y el footer no se muestra.
  onAccept?: () => Promise<void>
  onReject: () => void
  viewOnly?: boolean
}) {
  const [open, setOpen] = useState<number | null>(0)
  const [accepting, setAccepting] = useState(false)
  const [confirmedAge, setConfirmedAge] = useState(false)
  // Aceptación rápida (como la mayoría de las apps): en el ingreso se ve un
  // resumen; el texto completo está a un toque. En modo lectura (desde
  // Configuración) se abre directo el texto completo.
  const [showFull, setShowFull] = useState(viewOnly)

  async function accept() {
    if (!onAccept) return
    setAccepting(true)
    try {
      await onAccept()
    } finally {
      setAccepting(false)
    }
  }

  return (
    // Fondo negro a pantalla completa; el panel se acota a la columna angosta
    // de la app (max-w-lg) y se centra → en desktop queda vertical, no full-screen.
    <div className="fixed inset-0 z-[700] flex justify-center bg-black">
    <div className="flex h-full w-full max-w-lg flex-col bg-black">
      {/* Header fijo */}
      <div className="flex shrink-0 items-center justify-between border-b border-neutral-800 px-5 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h2 className="text-base font-bold text-white">Términos y Condiciones de Dealr</h2>
        <button onClick={onReject} aria-label="Cerrar" className="rounded-full p-1 text-neutral-500 transition hover:text-white">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      </div>

      {/* Contenido scrolleable */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <p className="text-lg font-bold text-white">Dealr — Términos y Condiciones de Uso</p>
        <p className="mt-0.5 text-xs text-neutral-500">Última actualización: 30 de junio de 2026</p>

        {!showFull ? (
          /* Resumen rápido: lo esencial en 4 puntos + link al texto completo. */
          <div className="mt-4 space-y-3">
            <p className="text-sm leading-relaxed text-neutral-300">
              Dealr es un marketplace local que conecta compradores y vendedores de Córdoba. Las
              operaciones se cierran entre las partes, por fuera de la app:{' '}
              <strong className="text-white">Dealr no procesa pagos ni es parte de la compraventa</strong>.
            </p>
            <ul className="space-y-2.5 rounded-2xl bg-neutral-900/50 p-4 text-sm leading-snug text-neutral-300 ring-1 ring-neutral-800">
              <li className="flex gap-2.5"><span className="text-emerald-400">✓</span> Tenés que ser mayor de 18 años.</li>
              <li className="flex gap-2.5"><span className="text-emerald-400">✓</span> Los productos son de los usuarios: revisá antes de pagar y encontrate en lugares públicos.</li>
              <li className="flex gap-2.5"><span className="text-emerald-400">✓</span> Prohibido publicar cosas ilegales (armas, drogas, robado, falsificado).</li>
              <li className="flex gap-2.5"><span className="text-emerald-400">✓</span> Podés calificar, denunciar y bloquear. Moderamos lo que rompe las reglas.</li>
            </ul>
            <button
              onClick={() => setShowFull(true)}
              className="text-sm font-semibold text-emerald-400 underline-offset-2 hover:underline"
            >
              Leer los Términos completos →
            </button>
          </div>
        ) : (
          <>
            {!viewOnly && (
              <button onClick={() => setShowFull(false)} className="mt-3 text-sm font-medium text-neutral-500">
                ← Volver al resumen
              </button>
            )}
            <div className="mt-4 divide-y divide-neutral-900 overflow-hidden rounded-2xl ring-1 ring-neutral-800">
              {SECTIONS.map((s, i) => {
                const isOpen = open === i
                return (
                  <div key={i}>
                    <button
                      onClick={() => setOpen(isOpen ? null : i)}
                      className="flex w-full items-center justify-between gap-3 bg-neutral-900/40 px-4 py-3 text-left text-sm font-semibold text-white transition active:bg-neutral-900"
                    >
                      <span>{s.title}</span>
                      <svg
                        viewBox="0 0 24 24"
                        className={`h-4 w-4 shrink-0 text-neutral-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="m6 9 6 6 6-6" />
                      </svg>
                    </button>
                    {isOpen && (
                      <div className="space-y-3 px-4 py-3 text-[13px] leading-relaxed text-neutral-300">
                        {s.blocks.map((b, j) =>
                          'ul' in b ? (
                            <ul key={j} className="list-disc space-y-1 pl-5">
                              {b.ul.map((li, k) => (
                                <li key={k}>{li}</li>
                              ))}
                            </ul>
                          ) : (
                            <p key={j}>{b.p}</p>
                          ),
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Footer fijo: confirmación de edad + las dos acciones */}
      {!viewOnly && (
      <div className="shrink-0 border-t border-neutral-800 px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <label className="mb-3 flex items-start gap-3">
          <input
            type="checkbox"
            checked={confirmedAge}
            onChange={(e) => setConfirmedAge(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-emerald-500"
          />
          <span className="text-sm text-neutral-300">Confirmo que soy mayor de 18 años.</span>
        </label>
        <div className="flex gap-3">
          <button
            onClick={onReject}
            disabled={accepting}
            className="flex-1 rounded-full py-3 text-sm font-semibold text-neutral-300 ring-1 ring-neutral-700 transition active:bg-neutral-900 disabled:opacity-50"
          >
            Rechazar
          </button>
          <button
            onClick={accept}
            disabled={accepting || !confirmedAge}
            className="flex flex-1 items-center justify-center gap-2 rounded-full py-3 text-sm font-semibold text-white transition disabled:opacity-40"
            style={{ backgroundColor: '#10B981' }}
          >
            {accepting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
            {accepting ? 'Guardando…' : 'Acepto los Términos'}
          </button>
        </div>
      </div>
      )}
    </div>
    </div>
  )
}

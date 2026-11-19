# Por qué no usamos una herramienta de testing con IA ya hecha para el chatbot de Cauce

> Evaluación de **Cekura**, **TestSprite** y **Momentic** para pruebas de punta a punta (E2E) del
> chatbot de WhatsApp de Cauce (repo `prestobotsv3`, producto Salud).
> Fecha: 2026-11-19. Basado en nuestras pruebas y en la documentación pública de cada proveedor a
> esta fecha.

---

## 1. Resumen

Estas herramientas prueban **lo que un producto muestra o dice**. El riesgo de nuestro chatbot
está en **lo que hace por detrás**: si el turno realmente queda creado en Macena y en nuestra base
de datos.

Ninguna de las tres puede verificarlo sin que construyamos nosotros la parte difícil: enviar
mensajes por el canal real del bot, leer sus respuestas en Firestore y verificar el turno en
Macena. Una vez construido eso, la herramienta aporta poco más, y suma costo, dependencia del
proveedor y datos de pacientes saliendo de nuestros sistemas.

No es una crítica a las herramientas. Son buenas en aquello para lo que fueron diseñadas.
Simplemente, nuestro producto tiene otra forma.

| Herramienta    | Diseñada para                                          | Problema principal con nuestro bot                                                                             |
| -------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| **Momentic**   | Recorrer páginas web y apps móviles haciendo clic      | El bot no tiene pantalla donde hacer clic. No soporta WhatsApp.                                                |
| **TestSprite** | Interfaces web y APIs REST que responden a cada pedido | Nuestro webhook siempre responde "recibido", así que toda prueba parecería aprobada.                           |
| **Cekura**     | Conversaciones con agentes de voz y chat               | Evalúa lo que el bot _dice_, no lo que _hace_. Su documentación no menciona botones, listas ni WhatsApp Flows. |

---

## 2. Qué hace falta para probar nuestro chatbot

El chatbot de Cauce no vive en una página web. Un paciente escribe por WhatsApp, el mensaje viaja
a través de **Gupshup** hasta nuestros servidores, **Dialogflow CX** lo interpreta y el bot reserva
el turno en **Macena** (el sistema de agendas de las clínicas).

Para probar una reserva de principio a fin, una prueba tiene que:

1. **Enviar un mensaje como paciente.** Va por el webhook de Gupshup (la dirección donde el bot
   recibe los mensajes de WhatsApp) o como un mensaje real de WhatsApp.
2. **Obtener la respuesta del bot.** El webhook solo responde "recibido". El bot trabaja en segundo
   plano y guarda su respuesta en **Firestore**, así que la prueba tiene que leer la base de datos
   para verla.
3. **Manejar los formatos de WhatsApp.** El bot responde con botones, listas y **WhatsApp Flows**
   (los formularios de reserva dentro del chat).
4. **Verificar qué pasó realmente.** ¿Se creó el turno en Macena? ¿Quedó guardado en Firestore?
5. **Evaluar las respuestas en español.** Son lenguaje natural, así que comparar el texto exacto
   falla con demasiada facilidad. Tiene que evaluarlas un juez con IA.

Los puntos 2 y 4 son donde está la mayor parte del riesgo, y ninguna herramienta los cubre.

---

## 3. Herramienta por herramienta

### 3.1 Momentic — hecha para recorrer páginas web y apps móviles

- Maneja navegadores Chromium, simuladores de iOS y emuladores de Android. Sus funciones de IA
  (selectores que se reparan solos, comparaciones visuales) necesitan una pantalla donde hacer
  clic. **El bot no tiene pantalla.**
- **No soporta WhatsApp ni chatbots.** Su bandeja de SMS no es WhatsApp.
- Se la _puede_ forzar: un paso HTTP envía el mensaje al webhook y un paso de JavaScript lee
  Firestore. Pero entonces estaríamos escribiendo nuestro propio sistema de pruebas dentro del
  entorno de otro, pagando por funciones de IA que no usamos.

**Conclusión:** no es el tipo de herramienta adecuado para el bot. Se podría considerar más
adelante para el panel de administración o la landing, que sí tienen pantalla.

### 3.2 TestSprite — hecha para interfaces web y APIs REST

- Sus pruebas de backend llaman a un endpoint y revisan la respuesta. Nuestro webhook siempre
  devuelve "200 recibido", haga lo que haga el bot después. **TestSprite marcaría todas las
  pruebas como aprobadas, aunque el bot haya respondido cualquier cosa o no haya respondido.**
- Su documentación no menciona flujos asíncronos o basados en eventos, verificaciones en base de
  datos, ni chatbots.
- Escribe casos de prueba leyendo el código y la URL de la app. En nuestro caso propondría pruebas
  de los endpoints de la API, no conversaciones de pacientes basadas en el agente de
  Dialogflow CX.
- Cuando la revisamos, su integración con GitHub solo volvía a correr las pruebas existentes. No
  escribía pruebas nuevas cuando cambiaba el código.

**Conclusión:** su modelo pedido → respuesta no encaja con un bot que responde en forma asíncrona y
por otro canal.

### 3.3 Cekura — la más cercana, pero evalúa palabras, no resultados

Cekura está hecha para agentes conversacionales. Tiene pruebas de texto por WhatsApp, usuarios
simulados y métricas evaluadas con IA. Es la única de las tres que entiende de "conversaciones".
Aun así:

- **Necesita una línea de WhatsApp real.** Envía mensajes reales de WhatsApp desde su propio
  número al número del bot (su guía de configuración pide credenciales de Twilio). Nuestro bot de
  stage necesitaría un número real accesible desde afuera, y aplica la ventana de 24 horas de
  WhatsApp.
- **Solo texto.** Su documentación de WhatsApp solo describe texto. No menciona botones, listas ni
  Flows, y el recorrido de reserva de Cauce depende de ellos.
- **No verifica resultados.** Evalúa la transcripción de la conversación, y su documentación no
  muestra ninguna forma de consultar Firestore ni Macena. **Un bot que dice "tu turno está
  confirmado" sin crearlo en Macena aprobaría la prueba.** Es el peor error que puede tener este
  bot.
- **Los escenarios se escriben a mano.** Los casos de prueba son instrucciones que alguien
  escribe. No los descubre en el agente de Dialogflow CX ni en los archivos de los Flows.
- **El atajo es casi todo el trabajo.** Puede conectarse a través de una dirección WebSocket que
  alojemos nosotros. Pero tendríamos que construir un puente entre Cekura, el webhook de Gupshup y
  Firestore, que es la mayor parte del trabajo de probar el bot de todos modos.

**Conclusión:** útil para evaluar la calidad de la conversación, pero ciega a si el turno realmente
se reservó.

---

## 4. Problemas comunes a las tres

- **Los datos de pacientes salen de nuestros sistemas.** Las conversaciones de prueba incluyen
  datos de salud y quedarían guardadas en un servicio de terceros.
- **No distinguen nuestros errores de las caídas ajenas.** Ninguna diferencia una falla de nuestro
  bot de un Gupshup lento o del sistema de pruebas de Macena caído. Cada caída parecería un error
  del bot.
- **Dependencia y costo.** Las pruebas viven en la plataforma del proveedor, y se paga por usuario
  o por ejecución.
- **La parte difícil sigue siendo nuestra.** La integración con el canal, la lectura de Firestore y
  la verificación en Macena las tenemos que construir nosotros en cualquier caso.

---

## 5. Qué hacemos en su lugar

Estamos construyendo nuestra propia plataforma de pruebas sobre piezas de código abierto probadas
(ver [04-e2e-testing-strategy.md](../04-e2e-testing-strategy.md) y
[06-mvp-scope.md](../06-mvp-scope.md)):

- Un runner que **actúa como paciente** y envía mensajes al webhook real en **salud-stage** (nunca
  en producción).
- **Lee las respuestas del bot** en Firestore, con acceso de solo lectura.
- **Verifica el turno** en el sistema de pruebas de Macena.
- Un **juez con IA (Claude)** evalúa las respuestas en español, pero nunca puede convertir una
  verificación fallida en aprobada.
- **Los casos de prueba se proponen automáticamente** a partir del agente de Dialogflow CX y de los
  archivos de los Flows, y los aprueba un administrador.
- Las fallas se convierten en **tarjetas de Jira**.

La **decisión de aprobado/fallado se basa en verificaciones de sí o no** (¿llegó la respuesta?,
¿están los botones correctos?, ¿existe el turno?). La IA solo evalúa lo que no se puede verificar
de forma exacta.

---

## Fuentes

- Cekura — [Pruebas por WhatsApp](https://docs.cekura.ai/documentation/guides/testing-agents/whatsapp-testing),
  [Guía de configuración del agente](https://docs.cekura.ai/documentation/key-concepts/agents/Agent_Setup_Guide),
  [Pruebas de chat](https://docs.cekura.ai/documentation/integrations/chat-testing),
  [Blog: QA de agentes de chat](https://www.cekura.ai/blogs/cekura-chat-agent-quality-assurance-that-helps-you-ship-with-confidence)
- Momentic — [Índice de documentación](https://momentic.ai/docs/llms.txt),
  [Solicitudes de red](https://momentic.ai/docs/guides/page-interactions/network-requests.md)
- TestSprite — [Índice de documentación](https://docs.testsprite.com/llms.txt),
  [Pruebas de backend](https://docs.testsprite.com/backend)

/** Demo knowledge base for NovaCare Medical Center (administrative content only — no clinical advice). */
export const KNOWLEDGE_TEXTS: { title: string; category: string; text: string }[] = [
  {
    title: 'Servicios de NovaCare Medical Center',
    category: 'servicios',
    text: `# Servicios

NovaCare Medical Center ofrece atención especializada en tres áreas: Cardiología, Dermatología y Ortopedia. Todas las consultas se realizan con cita previa en nuestras sedes de Chicó y Usaquén, en Bogotá.

## Cardiología
El servicio de Cardiología ofrece consulta de cardiología, electrocardiograma (ECG) y ecocardiograma. Está dirigido a adultos que requieren valoración del corazón, control de presión arterial o seguimiento cardiovascular. El especialista es el Dr. Carlos Pérez.

## Dermatología
El servicio de Dermatología ofrece consulta dermatológica, control de lunares con dermatoscopia y tratamiento de acné. Atiende a adolescentes y adultos. La especialista es la Dra. María García.

## Ortopedia
El servicio de Ortopedia ofrece consulta de ortopedia, valoración de rodilla e infiltración articular. Atiende lesiones deportivas, dolor articular y seguimiento posoperatorio. El especialista es el Dr. Juan Rodríguez.

## Telemedicina
Las consultas de control de Dermatología y Cardiología pueden realizarse por videollamada cuando el especialista lo autorice. La primera consulta siempre es presencial.

## Servicios que no ofrecemos
NovaCare no cuenta con servicio de urgencias, hospitalización, pediatría ni laboratorio clínico propio. Para urgencias, acude al servicio de urgencias más cercano o llama al 123.`,
  },
  {
    title: 'Políticas de la clínica',
    category: 'politicas',
    text: `# Políticas de atención

## Política de cancelación y reprogramación
Las citas pueden cancelarse o reprogramarse sin costo hasta 24 horas antes de la hora programada. Las cancelaciones con menos de 24 horas de anticipación o la inasistencia sin aviso pueden generar un cargo administrativo equivalente al 30% del valor de la consulta. Puedes cancelar o reprogramar con Alejandro AI, en el portal del paciente o llamando a recepción.

## Llegada y documentos
Te pedimos llegar 15 minutos antes de tu cita para el registro. Trae tu documento de identidad, el carné de tu medicina prepagada o seguro (si aplica) y los exámenes o resultados previos relacionados con tu consulta. Si llegas más de 15 minutos tarde, es posible que debamos reprogramar tu cita.

## Métodos de pago
Aceptamos tarjetas débito y crédito (Visa, Mastercard, American Express), transferencias PSE, Nequi y efectivo. El pago se realiza en recepción antes de la consulta. Emitimos factura electrónica a nombre del paciente o de una empresa.

## Seguros y medicina prepagada
Tenemos convenio con Colsanitas, Medisanitas, Allianz y Sura Medicina Prepagada. Actualmente no atendemos por EPS del régimen contributivo. Si tu plan no aparece en esta lista, la consulta se atiende como particular.

## Privacidad y datos personales
NovaCare trata los datos personales de acuerdo con su política de tratamiento de datos. Alejandro AI solo usa tus datos para gestionar tus citas y responder tus solicitudes administrativas; no comparte información con terceros sin tu autorización. Puedes solicitar la actualización o eliminación de tus datos escribiendo a privacidad@novacare.co.

## Acompañantes
Los pacientes pueden asistir con un acompañante. Los menores de edad deben asistir con su madre, padre o acudiente.`,
  },
  {
    title: 'Preparación para citas y exámenes',
    category: 'preparacion',
    text: `# Preparación administrativa para tu cita

## Electrocardiograma (ECG)
Llega 15 minutos antes. Usa ropa cómoda que permita descubrir el pecho con facilidad. El examen dura aproximadamente 30 minutos incluyendo el registro. Trae electrocardiogramas anteriores si los tienes.

## Ecocardiograma
Llega 15 minutos antes y trae la orden médica y los resultados de exámenes cardiológicos previos. La duración aproximada es de 45 minutos.

## Consulta dermatológica y control de lunares
Asiste sin maquillaje en la zona a evaluar y sin esmalte si la consulta es por uñas. Si usas productos o tratamientos tópicos, lleva la lista de nombres para mostrarla al especialista.

## Consulta de ortopedia
Trae radiografías, resonancias o ecografías previas (imágenes y reportes) y usa ropa que permita evaluar la articulación.`,
  },
];

export const KNOWLEDGE_FAQ: { question: string; answer: string }[] = [
  { question: '¿Tienen parqueadero?', answer: 'Sí. La sede Chicó cuenta con parqueadero para pacientes sin costo durante la cita (sujeto a disponibilidad). La sede Usaquén tiene convenio con el parqueadero público de la Calle 120 con tarifa preferencial.' },
  { question: '¿Cuál es el horario de atención?', answer: 'Atendemos de lunes a viernes de 7:00 a. m. a 7:00 p. m. y los sábados de 8:00 a. m. a 12:00 m. Los domingos y festivos la clínica permanece cerrada. Alejandro AI responde 24/7.' },
  { question: '¿Atienden urgencias?', answer: 'No. NovaCare no presta servicio de urgencias. Ante una emergencia llama al 123 o acude al servicio de urgencias más cercano.' },
  { question: '¿Puedo pedir la cita para otra persona?', answer: 'Sí, siempre que tengas sus datos de identificación y contacto. La cita quedará a nombre del paciente que será atendido.' },
  { question: '¿Cómo recibo los resultados de mis exámenes?', answer: 'Los reportes de electrocardiograma y ecocardiograma se entregan en el portal del paciente en un plazo de 2 días hábiles. El especialista los revisa contigo en la consulta de control. Alejandro AI no interpreta resultados.' },
  { question: '¿Atienden niños?', answer: 'Dermatología atiende pacientes desde los 12 años con acompañante. Cardiología y Ortopedia atienden pacientes mayores de 16 años. No contamos con servicio de pediatría.' },
  { question: '¿Hacen consultas virtuales?', answer: 'Sí, las consultas de control de Dermatología y Cardiología pueden hacerse por videollamada si el especialista lo autoriza. La primera consulta siempre es presencial.' },
  { question: '¿Qué pasa si llego tarde?', answer: 'Si llegas con más de 15 minutos de retraso es posible que debamos reprogramar tu cita para respetar el horario de los demás pacientes.' },
  { question: 'How can I book an appointment in English?', answer: 'You can chat with Alejandro AI in English 24/7 to book, reschedule or cancel appointments. Dr. Carlos Pérez and Dr. Juan Rodríguez also attend consultations in English.' },
  { question: 'What is the cancellation policy?', answer: 'Appointments can be cancelled or rescheduled free of charge up to 24 hours in advance. Late cancellations or no-shows may incur an administrative fee of 30% of the consultation price.' },
];

import type { LegalDocSet } from '../types';

/** Privacy policy template. Bracketed text ([…]) must be completed for each deployment. */
export const privacy: LegalDocSet = {
  es: {
    title: 'Política de privacidad y tratamiento de datos personales',
    intro:
      'Esta política explica qué datos personales se tratan cuando un paciente agenda, confirma o gestiona sus citas con una clínica a través de Alejandro AI (asistente web, portal del paciente, WhatsApp, teléfono y enlaces enviados por mensaje), con qué finalidades, quién es responsable y cómo ejercer tus derechos. Toma como referencia la Ley 1581 de 2012 y el Decreto 1377 de 2013 de Colombia e incorpora derechos de estilo RGPD.',
    sections: [
      {
        id: 'responsable',
        title: '1. Responsable y encargado del tratamiento',
        blocks: [
          'La clínica con la que interactúas es la RESPONSABLE del tratamiento de los datos de sus pacientes: decide para qué y cómo se usan. Sus datos de identificación y contacto aparecen al inicio de esta página cuando la abres desde el enlace de la clínica.',
          'Alejandro AI ([razón social del operador], [NIT], [domicilio]) presta la plataforma tecnológica y actúa como ENCARGADO del tratamiento: trata los datos por cuenta de la clínica y siguiendo sus instrucciones, según el Acuerdo de encargo de tratamiento.',
          'Respecto de los datos de las cuentas del personal de las clínicas (usuarios administradores, recepción, profesionales), Alejandro AI actúa como responsable para fines de gestión de la cuenta, facturación y seguridad del servicio.',
        ],
      },
      {
        id: 'datos',
        title: '2. Datos que tratamos',
        blocks: [
          'Según cómo uses el servicio, se pueden tratar las siguientes categorías de datos:',
          [
            'Identificación y contacto: nombre, apellidos, teléfono, correo electrónico, documento de identidad (si la clínica lo solicita), idioma preferido.',
            'Datos de citas: profesional, especialidad, servicio, sede o enlace de videoconsulta, fecha y hora, estado, cancelaciones, reprogramaciones, lista de espera y confirmaciones de asistencia.',
            'Conversaciones: mensajes que escribes o dictas al asistente y sus respuestas, incluidos los audios transcritos en el canal telefónico.',
            'Datos de salud que decidas compartir: motivo de consulta, síntomas mencionados en la conversación y respuestas del formulario previo a la cita. Son datos sensibles: su entrega es facultativa.',
            'Opiniones: calificación y comentario de las encuestas de satisfacción.',
            'Pagos: estado y valor del anticipo e identificador de la transacción. Los datos de la tarjeta los procesa directamente el proveedor de pagos; la plataforma no los almacena.',
            'Autorizaciones: versión de la política aceptada, fecha, canal y dirección IP/agente de usuario del momento de la autorización.',
            'Datos técnicos: registros de seguridad y auditoría, dirección IP, tipo de navegador, preferencias de idioma, tema y accesibilidad.',
          ],
        ],
      },
      {
        id: 'finalidades',
        title: '3. Finalidades',
        blocks: [
          [
            'Agendar, confirmar, reprogramar y cancelar citas, y gestionar listas de espera.',
            'Enviar recordatorios, enlaces de confirmación, formularios previos e instrucciones de la cita por los canales que elijas.',
            'Responder preguntas sobre la clínica (horarios, sedes, servicios, precios, preparación) con base en la información que la clínica publicó.',
            'Transferir la conversación a una persona del equipo de la clínica cuando sea necesario.',
            'Gestionar anticipos de pago de citas cuando la clínica los exija.',
            'Medir la calidad del servicio y la satisfacción, y prevenir fraude y abuso.',
            'Cumplir obligaciones legales, atender requerimientos de autoridades y ejercer o defender derechos.',
            'Solo con tu autorización adicional y separada: enviarte recordatorios de controles, campañas de la clínica y encuestas de satisfacción.',
          ],
        ],
      },
      {
        id: 'base-legal',
        title: '4. Base legal y autorización',
        blocks: [
          'El tratamiento se basa en tu autorización previa, expresa e informada, que se solicita antes de almacenar tus datos en el chat, al registrarte en el portal o al agendar por otro canal. La clínica conserva prueba de esa autorización (versión, fecha y canal).',
          'El suministro de datos sensibles (salud) es facultativo: no estás obligado a responder preguntas sobre ellos y puedes agendar sin compartirlos. Las comunicaciones comerciales requieren una autorización distinta que puedes retirar en cualquier momento desde el portal o respondiendo al mensaje.',
          'Algunos tratamientos se fundamentan además en la ejecución de la relación de prestación de servicios con la clínica, en obligaciones legales (por ejemplo, conservación de registros) y en el interés legítimo de proteger la seguridad del servicio.',
        ],
      },
      {
        id: 'ia',
        title: '5. Uso de inteligencia artificial',
        blocks: [
          'El asistente virtual utiliza modelos de lenguaje para entender tus mensajes y proponerte respuestas y horarios. Ten en cuenta que:',
          [
            'El asistente NO es un profesional de la salud: no diagnostica, no prescribe ni reemplaza una consulta médica. Ante una emergencia, llama a la línea de emergencias de tu país.',
            'No se toman decisiones médicas automatizadas. Las decisiones clínicas siempre las toma un profesional de la clínica.',
            'Las acciones con efectos sobre tus citas (reservar, cancelar, reprogramar) requieren tu confirmación explícita y se validan con reglas de la clínica.',
            'El personal de la clínica puede revisar las conversaciones y tomar el control en cualquier momento; puedes pedir hablar con una persona.',
            'Los proveedores de modelos de lenguaje se contratan con condiciones que impiden usar tus datos para entrenar sus modelos. Se minimizan los datos enviados a estos proveedores.',
          ],
        ],
      },
      {
        id: 'encargados',
        title: '6. Encargados y subencargados',
        blocks: [
          'Para prestar el servicio se apoya en proveedores que tratan datos por cuenta de la clínica, bajo contratos con obligaciones de confidencialidad y seguridad equivalentes. Las categorías son configurables según cada despliegue:',
          [
            'Infraestructura y alojamiento en la nube (servidores, bases de datos, copias de seguridad): [proveedor y región].',
            'Proveedores de modelos de lenguaje e IA: [proveedores configurados].',
            'Mensajería y comunicaciones: WhatsApp Business Platform, correo electrónico transaccional, SMS y telefonía de voz: [proveedores].',
            'Pagos en línea: [proveedor de pagos].',
            'Monitoreo de errores y soporte técnico: [proveedores, si aplica].',
          ],
          'La lista actualizada de subencargados está disponible para la clínica y puede solicitarse a través de los canales de contacto.',
        ],
      },
      {
        id: 'transferencias',
        title: '7. Transferencias y transmisiones internacionales',
        blocks: [
          'Algunos proveedores pueden estar ubicados fuera del país de la clínica. En esos casos la transmisión se realiza a países con nivel adecuado de protección o con garantías contractuales (cláusulas de transmisión de datos), conforme a la normativa aplicable y a las instrucciones de la clínica.',
        ],
      },
      {
        id: 'conservacion',
        title: '8. Conservación',
        blocks: [
          [
            'Datos de citas y del paciente: mientras exista relación con la clínica y durante los plazos que exija la normativa de registros de salud y contable aplicable a la clínica.',
            'Conversaciones con el asistente: [plazo configurable, por ejemplo 24 meses] desde el último mensaje, salvo que deban conservarse por una obligación legal o una reclamación.',
            'Registros de autorización y auditoría: mientras sean necesarios para demostrar el cumplimiento.',
            'Copias de seguridad: se sobrescriben en ciclos de [35] días.',
          ],
          'Cumplidos los plazos, los datos se eliminan o se anonimizan de forma irreversible.',
        ],
      },
      {
        id: 'seguridad',
        title: '9. Medidas de seguridad',
        blocks: [
          'Se aplican medidas técnicas y organizativas inspiradas en buenas prácticas del sector salud (por ejemplo, salvaguardas de estilo HIPAA), sin que ello implique una certificación:',
          [
            'Cifrado en tránsito (TLS) y cifrado en reposo de bases de datos y copias de seguridad.',
            'Aislamiento de datos entre clínicas y control de acceso por roles con mínimo privilegio.',
            'Tokens de sesión de corta duración, contraseñas con hash robusto y enlaces de un solo uso firmados para pacientes.',
            'Registro de auditoría de accesos y cambios sobre datos de pacientes.',
            'Filtrado de datos personales innecesarios antes de enviarlos a proveedores de IA y límites de uso para prevenir abuso.',
            'Copias de seguridad, monitoreo y procedimientos de respuesta a incidentes.',
          ],
        ],
      },
      {
        id: 'derechos',
        title: '10. Tus derechos y cómo ejercerlos',
        blocks: [
          'Como titular puedes:',
          [
            'Conocer, actualizar y rectificar tus datos.',
            'Solicitar prueba de la autorización otorgada.',
            'Ser informado sobre el uso que se ha dado a tus datos.',
            'Revocar la autorización y solicitar la supresión de tus datos cuando no exista un deber legal de conservarlos.',
            'Acceder gratuitamente a tus datos y obtener una copia portable (descarga en formato JSON desde el portal del paciente).',
            'Oponerte a comunicaciones comerciales en cualquier momento.',
            'Presentar quejas ante la autoridad de protección de datos (en Colombia, la Superintendencia de Industria y Comercio) después de haber agotado el trámite ante la clínica.',
          ],
          'Para ejercerlos, escribe a la clínica por los datos de contacto de esta página o desde el portal del paciente (sección "Privacidad y datos"). Las consultas se responden en un máximo de diez (10) días hábiles y los reclamos en un máximo de quince (15) días hábiles, prorrogables según la ley. La clínica puede anonimizar tus datos de forma irreversible cuando proceda la supresión.',
        ],
      },
      {
        id: 'menores',
        title: '11. Niñas, niños y adolescentes',
        blocks: [
          'El servicio no está dirigido a menores de edad sin acompañamiento. Las citas de menores deben ser gestionadas por su madre, padre o representante legal, quien otorga la autorización respetando el interés superior del menor y sus derechos fundamentales.',
        ],
      },
      {
        id: 'cookies',
        title: '12. Cookies y almacenamiento local',
        blocks: [
          'Se usa una cookie técnica segura (httpOnly) para mantener la sesión del personal y del portal, y almacenamiento local del navegador solo para preferencias del dispositivo (idioma, tema y accesibilidad). No se usan cookies publicitarias de terceros.',
        ],
      },
      {
        id: 'cambios',
        title: '13. Cambios a esta política',
        blocks: [
          'Cualquier cambio sustancial se publicará en esta página con su nueva fecha y versión. Si el cambio afecta las finalidades autorizadas, se solicitará nuevamente tu autorización.',
        ],
      },
      {
        id: 'contacto',
        title: '14. Contacto',
        blocks: [
          'Para asuntos relacionados con tus datos como paciente, contacta a la clínica. Para asuntos relacionados con la plataforma: [correo de privacidad del operador], [dirección], [teléfono].',
        ],
      },
    ],
  },
  en: {
    title: 'Privacy and personal data processing policy',
    intro:
      'This policy explains which personal data is processed when a patient books, confirms or manages appointments with a clinic through Alejandro AI (web assistant, patient portal, WhatsApp, phone and links sent by message), for which purposes, who is responsible and how to exercise your rights. It uses Colombia’s Law 1581 of 2012 and Decree 1377 of 2013 as a reference and includes GDPR-style rights.',
    sections: [
      {
        id: 'responsable',
        title: '1. Controller and processor',
        blocks: [
          'The clinic you interact with is the CONTROLLER of its patients’ data: it decides why and how the data is used. Its identification and contact details appear at the top of this page when you open it from the clinic’s link.',
          'Alejandro AI ([operator legal name], [tax ID], [address]) provides the technology platform and acts as PROCESSOR: it processes the data on behalf of the clinic and following its instructions, under the Data Processing Agreement.',
          'For the accounts of clinic staff (administrators, front desk, providers), Alejandro AI acts as controller for account management, billing and service security purposes.',
        ],
      },
      {
        id: 'datos',
        title: '2. Data we process',
        blocks: [
          'Depending on how you use the service, the following categories of data may be processed:',
          [
            'Identification and contact: first and last name, phone, email, ID document (if the clinic requires it), preferred language.',
            'Appointment data: provider, specialty, service, location or video link, date and time, status, cancellations, reschedules, waitlist and attendance confirmations.',
            'Conversations: messages you type or speak to the assistant and its replies, including transcribed audio on the phone channel.',
            'Health data you choose to share: reason for the visit, symptoms mentioned in the conversation and pre-visit form answers. This is sensitive data and providing it is optional.',
            'Feedback: rating and comment from satisfaction surveys.',
            'Payments: deposit status and amount and the transaction ID. Card details are processed directly by the payment provider; the platform does not store them.',
            'Authorizations: accepted policy version, date, channel and IP address/user agent at the time of authorization.',
            'Technical data: security and audit logs, IP address, browser type, language, theme and accessibility preferences.',
          ],
        ],
      },
      {
        id: 'finalidades',
        title: '3. Purposes',
        blocks: [
          [
            'Book, confirm, reschedule and cancel appointments, and manage waitlists.',
            'Send reminders, confirmation links, pre-visit forms and appointment instructions through the channels you choose.',
            'Answer questions about the clinic (hours, locations, services, prices, preparation) based on the information the clinic published.',
            'Hand the conversation over to a person on the clinic team when needed.',
            'Manage appointment deposits when the clinic requires them.',
            'Measure service quality and satisfaction, and prevent fraud and abuse.',
            'Comply with legal obligations, respond to authorities and exercise or defend rights.',
            'Only with your additional, separate authorization: send follow-up reminders, clinic campaigns and satisfaction surveys.',
          ],
        ],
      },
      {
        id: 'base-legal',
        title: '4. Legal basis and authorization',
        blocks: [
          'Processing is based on your prior, express and informed authorization, requested before your data is stored in the chat, when you register in the portal or when you book through another channel. The clinic keeps proof of that authorization (version, date and channel).',
          'Providing sensitive (health) data is optional: you do not have to answer questions about it and you can book without sharing it. Marketing communications require a separate authorization that you can withdraw at any time from the portal or by replying to the message.',
          'Some processing is also based on the performance of the service relationship with the clinic, on legal obligations (for example, record keeping) and on the legitimate interest of protecting the security of the service.',
        ],
      },
      {
        id: 'ia',
        title: '5. Use of artificial intelligence',
        blocks: [
          'The virtual assistant uses language models to understand your messages and suggest answers and time slots. Please note:',
          [
            'The assistant is NOT a health professional: it does not diagnose, prescribe or replace a medical visit. In an emergency, call your local emergency number.',
            'No automated medical decisions are made. Clinical decisions are always made by a clinic professional.',
            'Actions that affect your appointments (booking, cancelling, rescheduling) require your explicit confirmation and are validated against the clinic’s rules.',
            'Clinic staff can review conversations and take over at any time; you can ask to talk to a person.',
            'Language model providers are engaged under terms that prevent them from using your data to train their models. Data sent to these providers is minimized.',
          ],
        ],
      },
      {
        id: 'encargados',
        title: '6. Processors and sub-processors',
        blocks: [
          'The service relies on providers that process data on behalf of the clinic, under contracts with equivalent confidentiality and security obligations. Categories are configurable for each deployment:',
          [
            'Cloud infrastructure and hosting (servers, databases, backups): [provider and region].',
            'Language model and AI providers: [configured providers].',
            'Messaging and communications: WhatsApp Business Platform, transactional email, SMS and voice telephony: [providers].',
            'Online payments: [payment provider].',
            'Error monitoring and technical support: [providers, if any].',
          ],
          'The current list of sub-processors is available to the clinic and can be requested through the contact channels.',
        ],
      },
      {
        id: 'transferencias',
        title: '7. International transfers',
        blocks: [
          'Some providers may be located outside the clinic’s country. In those cases data is transferred to countries with an adequate level of protection or under contractual safeguards (data transfer clauses), in accordance with applicable law and the clinic’s instructions.',
        ],
      },
      {
        id: 'conservacion',
        title: '8. Retention',
        blocks: [
          [
            'Appointment and patient data: while the relationship with the clinic lasts and for the periods required by the health-record and accounting rules that apply to the clinic.',
            'Assistant conversations: [configurable period, e.g. 24 months] from the last message, unless they must be kept due to a legal obligation or a claim.',
            'Authorization and audit records: as long as needed to demonstrate compliance.',
            'Backups: overwritten in [35]-day cycles.',
          ],
          'Once these periods end, data is deleted or irreversibly anonymized.',
        ],
      },
      {
        id: 'seguridad',
        title: '9. Security measures',
        blocks: [
          'Technical and organizational measures inspired by healthcare industry practices (for example, HIPAA-style safeguards) are applied; this does not imply any certification:',
          [
            'Encryption in transit (TLS) and encryption at rest for databases and backups.',
            'Data isolation between clinics and role-based access control with least privilege.',
            'Short-lived session tokens, strongly hashed passwords and signed single-use links for patients.',
            'Audit logging of access to and changes on patient data.',
            'Filtering of unnecessary personal data before it is sent to AI providers, and rate limits to prevent abuse.',
            'Backups, monitoring and incident response procedures.',
          ],
        ],
      },
      {
        id: 'derechos',
        title: '10. Your rights and how to exercise them',
        blocks: [
          'As a data subject you can:',
          [
            'Know, update and correct your data.',
            'Request proof of the authorization you gave.',
            'Be informed about how your data has been used.',
            'Withdraw your authorization and request deletion of your data when there is no legal duty to keep it.',
            'Access your data free of charge and obtain a portable copy (JSON download from the patient portal).',
            'Object to marketing communications at any time.',
            'File complaints with the data protection authority (in Colombia, the Superintendence of Industry and Commerce) after completing the process with the clinic.',
          ],
          'To exercise them, write to the clinic using the contact details on this page or from the patient portal (“Privacy and data” section). Inquiries are answered within ten (10) business days and claims within fifteen (15) business days, extendable as provided by law. When deletion applies, the clinic may irreversibly anonymize your data.',
        ],
      },
      {
        id: 'menores',
        title: '11. Children and adolescents',
        blocks: [
          'The service is not intended for unaccompanied minors. Appointments for minors must be managed by their parent or legal guardian, who gives the authorization respecting the best interests of the child and their fundamental rights.',
        ],
      },
      {
        id: 'cookies',
        title: '12. Cookies and local storage',
        blocks: [
          'A secure technical cookie (httpOnly) keeps staff and portal sessions, and browser local storage is used only for device preferences (language, theme and accessibility). No third-party advertising cookies are used.',
        ],
      },
      {
        id: 'cambios',
        title: '13. Changes to this policy',
        blocks: [
          'Any material change will be published on this page with its new date and version. If the change affects the authorized purposes, your authorization will be requested again.',
        ],
      },
      {
        id: 'contacto',
        title: '14. Contact',
        blocks: [
          'For matters about your data as a patient, contact the clinic. For matters about the platform: [operator privacy email], [address], [phone].',
        ],
      },
    ],
  },
};

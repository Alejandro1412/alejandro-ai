import type { LegalDocSet } from '../types';

/** Terms of service template (clinic customers and patients). Bracketed text ([…]) must be completed. */
export const terms: LegalDocSet = {
  es: {
    title: 'Términos y condiciones del servicio',
    intro:
      'Estos términos regulan el uso de Alejandro AI, una plataforma de software como servicio que ofrece a clínicas y consultorios un asistente virtual para la atención de pacientes, agenda, recordatorios y operaciones relacionadas. También aplican, en lo pertinente, a los pacientes que usan el asistente, el portal o los enlaces enviados por la clínica.',
    sections: [
      {
        id: 'partes',
        title: '1. Partes y aceptación',
        blocks: [
          'El servicio lo presta [razón social del operador], identificada con [NIT], con domicilio en [ciudad, país] ("Alejandro AI"). El "Cliente" es la clínica, consultorio o institución que contrata un plan. Los "Usuarios" son las personas autorizadas por el Cliente para usar la plataforma, y los "Pacientes" son quienes interactúan con el asistente o el portal.',
          'Al crear una cuenta, contratar un plan o usar el servicio, aceptas estos términos. Si actúas en nombre de una organización, declaras tener facultades para obligarla.',
        ],
      },
      {
        id: 'servicio',
        title: '2. Descripción del servicio',
        blocks: [
          'La plataforma incluye, según el plan contratado:',
          [
            'Asistente virtual en web, portal del paciente, WhatsApp y teléfono, que responde preguntas con la información configurada por la clínica y gestiona citas.',
            'Agenda de profesionales, lista de espera, recordatorios, confirmaciones de asistencia, formularios previos y encuestas de satisfacción.',
            'Bandeja de conversaciones con traspaso a personas, analítica, reportes y registro de auditoría.',
            'Cobro de anticipos de citas a través de un proveedor de pagos externo.',
          ],
          'Las funcionalidades pueden evolucionar. Las mejoras no implican costo adicional salvo que se ofrezcan como un plan o complemento diferente.',
        ],
      },
      {
        id: 'cuentas',
        title: '3. Cuentas y acceso',
        blocks: [
          'El Cliente es responsable de las cuentas de sus Usuarios, de asignar roles y permisos adecuados, de mantener la confidencialidad de las credenciales y de retirar el acceso a quien ya no deba tenerlo. Debe informar de inmediato cualquier uso no autorizado.',
          'El personal de soporte de Alejandro AI solo accede a la cuenta del Cliente cuando es necesario para prestar soporte o por seguridad, con acceso temporal, motivado y registrado en auditoría.',
        ],
      },
      {
        id: 'clinica',
        title: '4. Responsabilidades del Cliente',
        blocks: [
          [
            'Configurar y mantener actualizada la información que usa el asistente (servicios, precios, horarios, sedes, políticas y preguntas frecuentes).',
            'Obtener y conservar las autorizaciones de tratamiento de datos de sus pacientes y publicar su propia política de privacidad cuando corresponda.',
            'Supervisar las conversaciones, atender los traspasos a personas y responder las solicitudes de los pacientes dentro de los plazos legales.',
            'Cumplir la normativa aplicable a la prestación de servicios de salud, historia clínica, publicidad y protección del consumidor.',
            'Usar las campañas y mensajes solo con pacientes que hayan autorizado comunicaciones.',
          ],
        ],
      },
      {
        id: 'ia',
        title: '5. Asistente de inteligencia artificial',
        blocks: [
          'El asistente es una herramienta administrativa y de orientación. El Cliente y los Pacientes reconocen que:',
          [
            'No es un profesional de la salud ni presta servicios médicos; no diagnostica, no prescribe y no sustituye la valoración de un profesional.',
            'No es un servicio de emergencias. Ante señales de alarma, el asistente indica contactar la línea de emergencias y puede escalar a una persona, pero no garantiza una respuesta inmediata.',
            'No toma decisiones médicas automatizadas. Toda decisión clínica corresponde a profesionales de la clínica.',
            'Las acciones sobre citas requieren confirmación explícita del paciente y se validan con las reglas configuradas.',
            'Puede cometer errores. El Cliente debe revisar periódicamente las respuestas, corregir la base de conocimiento y mantener la opción de atención humana.',
          ],
        ],
      },
      {
        id: 'pacientes',
        title: '6. Uso por parte de los pacientes',
        blocks: [
          'Los pacientes pueden usar el asistente, el portal y los enlaces gratuitamente. Deben proporcionar información veraz, no suplantar a otras personas y no compartir los enlaces personales que reciben. La relación de atención en salud se establece exclusivamente entre el paciente y la clínica.',
        ],
      },
      {
        id: 'planes',
        title: '7. Planes, pagos y suspensión',
        blocks: [
          [
            'Los planes, límites y precios vigentes se informan en la plataforma. Los precios no incluyen impuestos salvo indicación en contrario.',
            'El periodo de prueba, cuando exista, termina en la fecha indicada; al finalizar es necesario elegir un plan para seguir usando las funciones de escritura.',
            'Las facturas impagas generan un periodo de gracia de [N] días. Vencido ese plazo, la cuenta puede pasar a modo de solo lectura o ser suspendida hasta regularizar el pago; los datos se conservan durante la suspensión.',
            'El consumo de IA y mensajería puede estar sujeto a límites o cargos por uso, según el plan.',
          ],
        ],
      },
      {
        id: 'uso-aceptable',
        title: '8. Uso aceptable',
        blocks: [
          'Está prohibido:',
          [
            'Usar el servicio para fines ilícitos, para enviar mensajes no solicitados o para publicidad engañosa en salud.',
            'Cargar contenido que infrinja derechos de terceros o que contenga código malicioso.',
            'Intentar acceder a datos de otros clientes, eludir controles de seguridad, hacer ingeniería inversa o someter el servicio a pruebas de carga sin autorización.',
            'Configurar el asistente para dar diagnósticos, prescripciones o indicaciones médicas personalizadas.',
          ],
          'Alejandro AI puede suspender cuentas que incumplan estas reglas, notificando al Cliente salvo urgencia o mandato legal.',
        ],
      },
      {
        id: 'datos',
        title: '9. Protección de datos',
        blocks: [
          'El Cliente es responsable del tratamiento de los datos de sus pacientes y Alejandro AI actúa como encargado. Las obligaciones de cada parte se detallan en la Política de privacidad y en el Acuerdo de encargo de tratamiento, que forman parte de estos términos.',
        ],
      },
      {
        id: 'propiedad',
        title: '10. Propiedad intelectual',
        blocks: [
          'El software, la marca, el diseño y la documentación pertenecen a Alejandro AI o a sus licenciantes. El Cliente conserva la titularidad de sus datos y de los contenidos que carga, y concede a Alejandro AI una licencia limitada para tratarlos con el único fin de prestar el servicio.',
        ],
      },
      {
        id: 'terceros',
        title: '11. Servicios de terceros',
        blocks: [
          'Algunas funciones dependen de terceros (mensajería, telefonía, pagos, calendarios, proveedores de IA). Su disponibilidad y condiciones dependen de esos proveedores, y su uso puede estar sujeto a sus propios términos.',
        ],
      },
      {
        id: 'disponibilidad',
        title: '12. Disponibilidad y soporte',
        blocks: [
          'Alejandro AI hará esfuerzos comercialmente razonables para mantener el servicio disponible [objetivo de disponibilidad, por ejemplo 99,5 % mensual], salvo mantenimientos programados informados con antelación y eventos fuera de su control. El soporte se presta por [canales] en [horario].',
        ],
      },
      {
        id: 'responsabilidad',
        title: '13. Limitación de responsabilidad',
        blocks: [
          'En la medida permitida por la ley, Alejandro AI no responde por daños indirectos, lucro cesante ni por decisiones clínicas o administrativas tomadas por el Cliente. La responsabilidad total de Alejandro AI se limita a los valores pagados por el Cliente en los [doce (12)] meses anteriores al hecho que origina la reclamación. Nada de lo anterior limita la responsabilidad que no pueda limitarse legalmente.',
        ],
      },
      {
        id: 'terminacion',
        title: '14. Vigencia y terminación',
        blocks: [
          'El Cliente puede cancelar su plan en cualquier momento; la cancelación surte efecto al final del periodo pagado. A la terminación, el Cliente dispone de [30] días para exportar sus datos; vencido ese plazo, se eliminan o anonimizan conforme al Acuerdo de encargo de tratamiento.',
        ],
      },
      {
        id: 'ley',
        title: '15. Cambios, ley aplicable y contacto',
        blocks: [
          'Los cambios sustanciales a estos términos se notificarán con al menos [30] días de antelación. Estos términos se rigen por las leyes de [Colombia]; las controversias se someterán a los jueces de [ciudad], sin perjuicio de los mecanismos de protección al consumidor que apliquen.',
          'Contacto: [correo legal del operador], [dirección], [teléfono].',
        ],
      },
    ],
  },
  en: {
    title: 'Terms and conditions of service',
    intro:
      'These terms govern the use of Alejandro AI, a software-as-a-service platform that offers clinics and practices a virtual assistant for patient service, scheduling, reminders and related operations. They also apply, where relevant, to patients who use the assistant, the portal or the links sent by the clinic.',
    sections: [
      {
        id: 'partes',
        title: '1. Parties and acceptance',
        blocks: [
          'The service is provided by [operator legal name], tax ID [number], domiciled in [city, country] ("Alejandro AI"). The "Customer" is the clinic, practice or institution that subscribes to a plan. "Users" are the people authorized by the Customer to use the platform, and "Patients" are those who interact with the assistant or the portal.',
          'By creating an account, subscribing to a plan or using the service, you accept these terms. If you act on behalf of an organization, you represent that you are authorized to bind it.',
        ],
      },
      {
        id: 'servicio',
        title: '2. Service description',
        blocks: [
          'Depending on the plan, the platform includes:',
          [
            'Virtual assistant on web, patient portal, WhatsApp and phone, which answers questions with the information configured by the clinic and manages appointments.',
            'Provider schedules, waitlist, reminders, attendance confirmations, pre-visit forms and satisfaction surveys.',
            'Conversation inbox with human handoff, analytics, reports and audit log.',
            'Collection of appointment deposits through an external payment provider.',
          ],
          'Features may evolve. Improvements carry no additional cost unless offered as a different plan or add-on.',
        ],
      },
      {
        id: 'cuentas',
        title: '3. Accounts and access',
        blocks: [
          'The Customer is responsible for its Users’ accounts, for assigning appropriate roles and permissions, for keeping credentials confidential and for removing access from anyone who should no longer have it. It must report any unauthorized use immediately.',
          'Alejandro AI support staff access the Customer’s account only when needed to provide support or for security, with temporary, justified access recorded in the audit log.',
        ],
      },
      {
        id: 'clinica',
        title: '4. Customer responsibilities',
        blocks: [
          [
            'Configure and keep up to date the information used by the assistant (services, prices, hours, locations, policies and FAQs).',
            'Obtain and keep its patients’ data processing authorizations and publish its own privacy policy where applicable.',
            'Supervise conversations, handle human handoffs and answer patient requests within legal deadlines.',
            'Comply with the regulations that apply to healthcare services, medical records, advertising and consumer protection.',
            'Use campaigns and messages only with patients who authorized communications.',
          ],
        ],
      },
      {
        id: 'ia',
        title: '5. Artificial intelligence assistant',
        blocks: [
          'The assistant is an administrative and guidance tool. The Customer and Patients acknowledge that:',
          [
            'It is not a health professional and does not provide medical services; it does not diagnose, prescribe or replace a professional assessment.',
            'It is not an emergency service. When it detects warning signs, the assistant tells the patient to call emergency services and may escalate to a person, but it does not guarantee an immediate response.',
            'It makes no automated medical decisions. Every clinical decision belongs to the clinic’s professionals.',
            'Actions on appointments require the patient’s explicit confirmation and are validated against the configured rules.',
            'It can make mistakes. The Customer must regularly review answers, correct the knowledge base and keep the option of human service.',
          ],
        ],
      },
      {
        id: 'pacientes',
        title: '6. Use by patients',
        blocks: [
          'Patients can use the assistant, the portal and the links free of charge. They must provide truthful information, not impersonate others and not share the personal links they receive. The healthcare relationship exists exclusively between the patient and the clinic.',
        ],
      },
      {
        id: 'planes',
        title: '7. Plans, payments and suspension',
        blocks: [
          [
            'Current plans, limits and prices are shown in the platform. Prices exclude taxes unless stated otherwise.',
            'The trial period, if any, ends on the date shown; afterwards a plan must be chosen to keep using write features.',
            'Unpaid invoices start a grace period of [N] days. After that, the account may become read-only or be suspended until payment is made; data is kept during the suspension.',
            'AI and messaging consumption may be subject to limits or usage charges, depending on the plan.',
          ],
        ],
      },
      {
        id: 'uso-aceptable',
        title: '8. Acceptable use',
        blocks: [
          'It is forbidden to:',
          [
            'Use the service for unlawful purposes, to send unsolicited messages or for misleading health advertising.',
            'Upload content that infringes third-party rights or contains malicious code.',
            'Attempt to access other customers’ data, bypass security controls, reverse engineer or load-test the service without authorization.',
            'Configure the assistant to give diagnoses, prescriptions or personalized medical advice.',
          ],
          'Alejandro AI may suspend accounts that break these rules, notifying the Customer unless there is an emergency or a legal mandate.',
        ],
      },
      {
        id: 'datos',
        title: '9. Data protection',
        blocks: [
          'The Customer is the controller of its patients’ data and Alejandro AI acts as processor. Each party’s obligations are detailed in the Privacy Policy and the Data Processing Agreement, which form part of these terms.',
        ],
      },
      {
        id: 'propiedad',
        title: '10. Intellectual property',
        blocks: [
          'The software, brand, design and documentation belong to Alejandro AI or its licensors. The Customer keeps ownership of its data and the content it uploads, and grants Alejandro AI a limited license to process them solely to provide the service.',
        ],
      },
      {
        id: 'terceros',
        title: '11. Third-party services',
        blocks: [
          'Some features depend on third parties (messaging, telephony, payments, calendars, AI providers). Their availability and conditions depend on those providers, and their use may be subject to their own terms.',
        ],
      },
      {
        id: 'disponibilidad',
        title: '12. Availability and support',
        blocks: [
          'Alejandro AI will use commercially reasonable efforts to keep the service available [availability target, e.g. 99.5% monthly], except for scheduled maintenance announced in advance and events beyond its control. Support is provided via [channels] during [hours].',
        ],
      },
      {
        id: 'responsabilidad',
        title: '13. Limitation of liability',
        blocks: [
          'To the extent permitted by law, Alejandro AI is not liable for indirect damages, lost profits or clinical or administrative decisions made by the Customer. Alejandro AI’s total liability is limited to the amounts paid by the Customer in the [twelve (12)] months before the event giving rise to the claim. Nothing above limits liability that cannot be limited by law.',
        ],
      },
      {
        id: 'terminacion',
        title: '14. Term and termination',
        blocks: [
          'The Customer may cancel its plan at any time; cancellation takes effect at the end of the paid period. Upon termination, the Customer has [30] days to export its data; after that, it is deleted or anonymized according to the Data Processing Agreement.',
        ],
      },
      {
        id: 'ley',
        title: '15. Changes, governing law and contact',
        blocks: [
          'Material changes to these terms will be notified at least [30] days in advance. These terms are governed by the laws of [Colombia]; disputes will be submitted to the courts of [city], without prejudice to applicable consumer protection mechanisms.',
          'Contact: [operator legal email], [address], [phone].',
        ],
      },
    ],
  },
};

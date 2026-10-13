import type { LegalDocSet } from '../types';

/** Data processing agreement template (clinic = controller, platform = processor). Bracketed text must be completed. */
export const dpa: LegalDocSet = {
  es: {
    title: 'Acuerdo de encargo de tratamiento de datos personales',
    intro:
      'Este acuerdo (el "Acuerdo") forma parte de los Términos del servicio y regula el tratamiento de datos personales que Alejandro AI realiza por cuenta de la clínica cliente. Se inspira en el régimen colombiano (Ley 1581 de 2012, Decreto 1377 de 2013, compilados en el Decreto 1074 de 2015) y en el artículo 28 del RGPD como buena práctica.',
    sections: [
      {
        id: 'partes',
        title: '1. Partes y definiciones',
        blocks: [
          'RESPONSABLE: la clínica, consultorio o institución que contrata el servicio (el "Cliente"). ENCARGADO: [razón social del operador] ("Alejandro AI"). Titulares: pacientes, acudientes y demás personas cuyos datos trata el Cliente mediante la plataforma.',
          'Los términos "dato personal", "dato sensible", "tratamiento", "transmisión" y "transferencia" tienen el significado de la normativa aplicable.',
        ],
      },
      {
        id: 'objeto',
        title: '2. Objeto y roles',
        blocks: [
          'El Cliente, como responsable, determina las finalidades y medios esenciales del tratamiento. Alejandro AI, como encargado, trata los datos únicamente para prestar el servicio contratado y conforme a las instrucciones documentadas del Cliente.',
          'Alejandro AI no usará los datos del Cliente para fines propios, no los venderá ni los usará para entrenar modelos de inteligencia artificial, propios o de terceros.',
        ],
      },
      {
        id: 'alcance',
        title: '3. Naturaleza, finalidad y categorías de datos',
        blocks: [
          [
            'Naturaleza: alojamiento, organización, consulta, transmisión a canales de mensajería, análisis automatizado de mensajes por el asistente, generación de reportes y eliminación.',
            'Finalidad: atención y agendamiento de pacientes, recordatorios, listas de espera, formularios previos, encuestas, anticipos y analítica operativa para el Cliente.',
            'Titulares: pacientes y potenciales pacientes del Cliente, sus representantes y el personal del Cliente.',
            'Datos: identificación y contacto, citas, conversaciones, autorizaciones, opiniones, estado de pagos y, cuando el titular los comparta, datos sensibles de salud.',
            'Duración: la vigencia de la relación contractual más los plazos de devolución y eliminación de la cláusula 11.',
          ],
        ],
      },
      {
        id: 'instrucciones',
        title: '4. Instrucciones del responsable',
        blocks: [
          'Constituyen instrucciones documentadas: este Acuerdo, los Términos, la configuración que el Cliente realiza en la plataforma (canales, mensajes, plazos, integraciones) y las solicitudes escritas de sus administradores. Alejandro AI informará al Cliente si considera que una instrucción infringe la normativa y podrá suspender su ejecución hasta que se aclare.',
          'Si una autoridad exige a Alejandro AI tratar o revelar datos del Cliente, lo notificará al Cliente antes de hacerlo, salvo prohibición legal.',
        ],
      },
      {
        id: 'confidencialidad',
        title: '5. Confidencialidad',
        blocks: [
          'Alejandro AI garantiza que las personas autorizadas para tratar los datos se han comprometido a guardar confidencialidad, reciben formación en protección de datos y acceden solo a lo necesario para su función. Los accesos de soporte a la cuenta del Cliente son temporales, motivados y quedan registrados en auditoría.',
        ],
      },
      {
        id: 'seguridad',
        title: '6. Medidas de seguridad',
        blocks: [
          'Alejandro AI mantiene medidas técnicas y organizativas apropiadas al riesgo, incluyendo como mínimo:',
          [
            'Cifrado en tránsito (TLS 1.2 o superior) y cifrado en reposo.',
            'Aislamiento lógico por organización en todas las consultas y control de acceso basado en roles.',
            'Autenticación con contraseñas robustas, sesiones de corta duración y enlaces firmados de un solo uso para pacientes.',
            'Registro de auditoría de accesos, exportaciones, anonimizaciones y cambios de configuración.',
            'Minimización y filtrado de datos personales antes de su envío a proveedores de IA.',
            'Copias de seguridad cifradas, pruebas de restauración y plan de continuidad.',
            'Gestión de vulnerabilidades, actualizaciones de seguridad y revisión de código.',
          ],
          'Estas medidas se inspiran en marcos reconocidos del sector salud (por ejemplo, salvaguardas de estilo HIPAA o ISO/IEC 27001) sin que ello constituya una certificación.',
        ],
      },
      {
        id: 'subencargados',
        title: '7. Subencargados',
        blocks: [
          'El Cliente otorga una autorización general para que Alejandro AI contrate subencargados de las siguientes categorías: infraestructura en la nube, proveedores de modelos de lenguaje, mensajería (WhatsApp, correo, SMS), telefonía de voz, pagos y monitoreo. La lista vigente figura en el Anexo de subencargados: [enlace o documento].',
          'Alejandro AI notificará con al menos [30] días de antelación la incorporación o sustitución de subencargados. El Cliente podrá oponerse por motivos razonables relacionados con la protección de datos; si no se llega a una solución, podrá terminar el servicio afectado sin penalidad.',
          'Alejandro AI impondrá a cada subencargado obligaciones de protección de datos equivalentes a las de este Acuerdo y responderá frente al Cliente por su cumplimiento.',
        ],
      },
      {
        id: 'transferencias',
        title: '8. Transmisiones internacionales',
        blocks: [
          'Cuando un subencargado trate datos fuera del país del Cliente, Alejandro AI garantizará un nivel adecuado de protección mediante contratos de transmisión de datos u otros mecanismos reconocidos por la normativa aplicable, e informará al Cliente las ubicaciones relevantes.',
        ],
      },
      {
        id: 'incidentes',
        title: '9. Notificación de incidentes de seguridad',
        blocks: [
          'Alejandro AI notificará al Cliente cualquier incidente de seguridad que afecte sus datos sin dilación indebida y, en todo caso, dentro de las [48] horas siguientes a tener conocimiento. La notificación incluirá, en la medida disponible:',
          [
            'Naturaleza del incidente, categorías y número aproximado de titulares y registros afectados.',
            'Consecuencias probables.',
            'Medidas adoptadas o propuestas para mitigar los efectos.',
            'Punto de contacto para obtener más información.',
          ],
          'Alejandro AI apoyará al Cliente para que reporte el incidente a la autoridad de protección de datos (en Colombia, la Superintendencia de Industria y Comercio) y, cuando proceda, a los titulares.',
        ],
      },
      {
        id: 'asistencia',
        title: '10. Asistencia al responsable',
        blocks: [
          'Teniendo en cuenta la naturaleza del tratamiento, Alejandro AI asistirá al Cliente para:',
          [
            'Atender solicitudes de los titulares (consulta, rectificación, supresión, revocatoria, portabilidad), mediante herramientas de exportación en JSON y anonimización irreversible disponibles en la plataforma.',
            'Llevar prueba de las autorizaciones otorgadas por los titulares (versión, fecha y canal).',
            'Realizar evaluaciones de impacto y consultas previas cuando sean necesarias.',
            'Cumplir las obligaciones de seguridad y de notificación de incidentes.',
          ],
          'Si un titular se dirige directamente a Alejandro AI, este remitirá la solicitud al Cliente sin responderla de fondo, salvo instrucción en contrario.',
        ],
      },
      {
        id: 'devolucion',
        title: '11. Devolución y supresión de datos',
        blocks: [
          'Al terminar el servicio, el Cliente podrá exportar sus datos durante [30] días. Vencido ese plazo, Alejandro AI suprimirá o anonimizará de forma irreversible los datos del Cliente en un máximo de [90] días, incluidas las copias de seguridad según su ciclo de rotación, salvo que la ley exija conservarlos. A solicitud, emitirá una certificación de supresión.',
        ],
      },
      {
        id: 'auditorias',
        title: '12. Información y auditorías',
        blocks: [
          'Alejandro AI pondrá a disposición del Cliente la información necesaria para demostrar el cumplimiento de este Acuerdo, incluidos resúmenes de políticas de seguridad y, cuando existan, informes de auditorías independientes. El Cliente podrá realizar una auditoría al año, con aviso previo de [30] días, en horario laboral, a su costo y bajo compromiso de confidencialidad, o encargarla a un auditor independiente.',
        ],
      },
      {
        id: 'responsabilidad',
        title: '13. Responsabilidad, vigencia y prelación',
        blocks: [
          'Cada parte responde por el incumplimiento de sus obligaciones conforme a los Términos y a la ley. Este Acuerdo permanece vigente mientras Alejandro AI trate datos del Cliente. En caso de conflicto entre este Acuerdo y los Términos en materia de protección de datos, prevalece este Acuerdo.',
        ],
      },
      {
        id: 'contacto',
        title: '14. Contacto',
        blocks: ['Oficial de protección de datos o persona de contacto de Alejandro AI: [nombre], [correo], [teléfono]. Contacto del Cliente: el registrado como administrador de la cuenta.'],
      },
    ],
  },
  en: {
    title: 'Data processing agreement',
    intro:
      'This agreement (the "Agreement") forms part of the Terms of Service and governs the processing of personal data that Alejandro AI performs on behalf of the customer clinic. It draws on the Colombian framework (Law 1581 of 2012 and Decree 1377 of 2013, compiled in Decree 1074 of 2015) and on GDPR Article 28 as good practice.',
    sections: [
      {
        id: 'partes',
        title: '1. Parties and definitions',
        blocks: [
          'CONTROLLER: the clinic, practice or institution subscribing to the service (the "Customer"). PROCESSOR: [operator legal name] ("Alejandro AI"). Data subjects: patients, guardians and any other people whose data the Customer processes through the platform.',
          'The terms "personal data", "sensitive data", "processing", "transmission" and "transfer" have the meaning given in applicable law.',
        ],
      },
      {
        id: 'objeto',
        title: '2. Subject matter and roles',
        blocks: [
          'The Customer, as controller, determines the purposes and essential means of processing. Alejandro AI, as processor, processes the data only to provide the contracted service and in accordance with the Customer’s documented instructions.',
          'Alejandro AI will not use the Customer’s data for its own purposes, will not sell it and will not use it to train its own or third-party artificial intelligence models.',
        ],
      },
      {
        id: 'alcance',
        title: '3. Nature, purpose and categories of data',
        blocks: [
          [
            'Nature: hosting, organization, consultation, transmission to messaging channels, automated analysis of messages by the assistant, reporting and deletion.',
            'Purpose: patient service and scheduling, reminders, waitlists, pre-visit forms, surveys, deposits and operational analytics for the Customer.',
            'Data subjects: the Customer’s patients and prospective patients, their representatives and the Customer’s staff.',
            'Data: identification and contact, appointments, conversations, authorizations, feedback, payment status and, when the data subject shares it, sensitive health data.',
            'Duration: the term of the contractual relationship plus the return and deletion periods in clause 11.',
          ],
        ],
      },
      {
        id: 'instrucciones',
        title: '4. Controller’s instructions',
        blocks: [
          'Documented instructions are: this Agreement, the Terms, the configuration the Customer sets in the platform (channels, messages, periods, integrations) and written requests from its administrators. Alejandro AI will inform the Customer if it believes an instruction infringes the law and may suspend it until clarified.',
          'If an authority requires Alejandro AI to process or disclose the Customer’s data, it will notify the Customer beforehand unless legally prohibited.',
        ],
      },
      {
        id: 'confidencialidad',
        title: '5. Confidentiality',
        blocks: [
          'Alejandro AI ensures that people authorized to process the data have committed to confidentiality, receive data protection training and access only what their role requires. Support access to the Customer’s account is temporary, justified and recorded in the audit log.',
        ],
      },
      {
        id: 'seguridad',
        title: '6. Security measures',
        blocks: [
          'Alejandro AI maintains technical and organizational measures appropriate to the risk, including at least:',
          [
            'Encryption in transit (TLS 1.2 or higher) and encryption at rest.',
            'Logical isolation per organization in every query and role-based access control.',
            'Authentication with strong passwords, short-lived sessions and signed single-use links for patients.',
            'Audit logging of access, exports, anonymizations and configuration changes.',
            'Minimization and filtering of personal data before it is sent to AI providers.',
            'Encrypted backups, restore tests and a continuity plan.',
            'Vulnerability management, security updates and code review.',
          ],
          'These measures are inspired by recognized healthcare frameworks (for example, HIPAA-style safeguards or ISO/IEC 27001) and do not constitute a certification.',
        ],
      },
      {
        id: 'subencargados',
        title: '7. Sub-processors',
        blocks: [
          'The Customer gives a general authorization for Alejandro AI to engage sub-processors in these categories: cloud infrastructure, language model providers, messaging (WhatsApp, email, SMS), voice telephony, payments and monitoring. The current list is in the Sub-processor Annex: [link or document].',
          'Alejandro AI will give at least [30] days’ notice before adding or replacing sub-processors. The Customer may object on reasonable data protection grounds; if no solution is reached, it may terminate the affected service without penalty.',
          'Alejandro AI will impose on each sub-processor data protection obligations equivalent to those in this Agreement and remains liable to the Customer for their compliance.',
        ],
      },
      {
        id: 'transferencias',
        title: '8. International transfers',
        blocks: [
          'When a sub-processor processes data outside the Customer’s country, Alejandro AI will ensure an adequate level of protection through data transfer agreements or other mechanisms recognized by applicable law, and will inform the Customer of the relevant locations.',
        ],
      },
      {
        id: 'incidentes',
        title: '9. Security incident notification',
        blocks: [
          'Alejandro AI will notify the Customer of any security incident affecting its data without undue delay and in any case within [48] hours of becoming aware of it. The notice will include, to the extent available:',
          [
            'The nature of the incident and the categories and approximate number of data subjects and records affected.',
            'Likely consequences.',
            'Measures taken or proposed to mitigate its effects.',
            'A contact point for more information.',
          ],
          'Alejandro AI will help the Customer report the incident to the data protection authority (in Colombia, the Superintendence of Industry and Commerce) and, where required, to data subjects.',
        ],
      },
      {
        id: 'asistencia',
        title: '10. Assistance to the controller',
        blocks: [
          'Taking into account the nature of the processing, Alejandro AI will assist the Customer to:',
          [
            'Handle data subject requests (access, rectification, deletion, withdrawal, portability) through the JSON export and irreversible anonymization tools available in the platform.',
            'Keep proof of the authorizations given by data subjects (version, date and channel).',
            'Carry out impact assessments and prior consultations when needed.',
            'Meet security and incident notification obligations.',
          ],
          'If a data subject contacts Alejandro AI directly, it will forward the request to the Customer without answering it on the merits, unless instructed otherwise.',
        ],
      },
      {
        id: 'devolucion',
        title: '11. Return and deletion of data',
        blocks: [
          'When the service ends, the Customer may export its data for [30] days. After that, Alejandro AI will delete or irreversibly anonymize the Customer’s data within [90] days, including backups according to their rotation cycle, unless the law requires keeping it. On request, it will issue a deletion certificate.',
        ],
      },
      {
        id: 'auditorias',
        title: '12. Information and audits',
        blocks: [
          'Alejandro AI will make available to the Customer the information needed to demonstrate compliance with this Agreement, including summaries of security policies and, where available, independent audit reports. The Customer may carry out one audit per year, with [30] days’ prior notice, during business hours, at its own cost and under confidentiality, or commission it to an independent auditor.',
        ],
      },
      {
        id: 'responsabilidad',
        title: '13. Liability, term and precedence',
        blocks: [
          'Each party is liable for breach of its obligations under the Terms and the law. This Agreement remains in force for as long as Alejandro AI processes the Customer’s data. In case of conflict between this Agreement and the Terms on data protection matters, this Agreement prevails.',
        ],
      },
      {
        id: 'contacto',
        title: '14. Contact',
        blocks: ['Alejandro AI data protection officer or contact person: [name], [email], [phone]. Customer contact: the account administrator on record.'],
      },
    ],
  },
};

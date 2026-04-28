import fs from 'fs';

const rawData = `Aaron Lopez Villarroel	 9700	29	1/7/2022
Aarón Nicolás Cussi Quispe	1030	3	18/9/2025
Abdiel Fernando Giron Contreras	970	3	11/2/2026
Adrian Becerra Quintanilla	3120	10	19/6/2023
Adrián Vázquez Llano	1650	4	1/9/2025
Adriano Guzman Quezada	15705	33	31/5/2023
Agustín Eduardo Moreno Villena	350	1	13/4/2026
Agustin Espinoza Paz	1065	5	6/11/2025
Alejandro Ávila Romero	17470	36	30/6/2022
Alejandro Barriga Mojica	7080	12	1/4/2025
Alexander Catorceno Mesa	3350	8	5/6/2025
Alexander Quispe cutipa	8145	25	2/9/2022
Alexander Yareca Trujillo	800	2	13/10/2025
Ali Godoy Pomacusi	220	1	12/3/2026
Ali Moron Espinoza	1100	3	11/8/2022
Ana Fabia Osinaga Ortiz	14335	39	9/1/2023
Andy Herrera Lino	450	1	19/3/2025
Angel Fabian Fuentes	1110	5	21/10/2025
Angel Gadiel Saucedo Balcazar	800	2	13/1/2026
Angel Gael Teran Paz	2050	8	18/8/2025
Anthony Santiago Alvarez Chambi	16060	38	16/2/2023
Antonio Cuellar Martinez	1970	4	2/12/2025
Ariel Valverde Teodovich	2680	7	26/8/2024
Augusto Ribera Torrico	13120	35	10/8/2022
Augusto Salinas Virreira	8045	20	1/2/2023
Axel Liam Zapata Warachi	220	1	5/12/2025
Benjamin Larach Lopez	350	1	2/3/2026
Benjamin Roca Pereira	6520	16	17/1/2025
Benjamin Schwartz Cacic	15266,75	29	27/11/2022
Braulio Kaleb Prudencio	3540	9	4/10/2023
Bruno Andrés Flores Parada	5250	15	28/2/2023
Bruno Baldiviezo Ferreira	1515	6	19/2/2024
Bruno Mateo Siles Claros	2220	3	9/2/2026
Bruno Menacho Garcia	3760	17	18/4/2023
Bruno Santiago Reynat Vargas	1940	8	1/12/2023
Bruno Soliz Mojica	12680	25	11/7/2022
Caleb Dunois De La Barca	1820	6	4/8/2022
Camilo Inchauste Wilde	470	2	19/2/2026
Carlito Romero Aguilar	750	4	21/3/2023
Carlos Andres Argandoña Peña	9000	22	7/3/2024
Carlos Andres Claure Molina	550	1	7/1/2026
Carlos Gustavo Limpias Matienzo	16295	26	16/1/2024
Carlos Santiago Subirana Valenzuela	300	1	15/4/2026
Cesar Luis Sandoval Cossio	750	3	17/2/2025
Cesilia Quina Vargas	220	1	12/3/2026
Christian Mateo Rocha	970	5	18/9/2025
Cristobal Mercado Roca	4000	10	10/2/2025
Daniel Escalante Sandoval	3285	14	3/4/2023
Daniel Mercado Villena	1380	4	27/3/2023
Daniel Rodolfo Quintanilla Videz	220	1	14/4/2026
David Josue Andrade Sosa	2940	9	9/12/2024
Davinia Yambatuy Serrudo	200	1	11/3/2026
Delfo Dhajuan Castro Álvarez	1040	6	26/2/2024
Diego Aguirre Eguez	26335	42	3/10/2022
Diego Meneses Monroy	26235	43	10/8/2022
Diego Quezada Morales	24455	29	1/3/2023
Dylan Yambatuy Serrudo	870	2	11/2/2026
Edson Hermes Rojas Rodriguez	3120	7	5/5/2025
Eduardo Piñera Ortiz	11095	33	18/7/2022
Eduardo Roca Cuellar	10490	33	7/7/2022
Emanuel Flores Cuellar	3695	20	9/1/2023
Emiliano Chávez Salinas	220	1	23/2/2026
Emiliano Cordel	1010	4	16/10/2025
Emiliano Gomez Robles	11990	25	8/3/2024
Emiliano Rojas Lara	26640	38	13/3/2023
Enoc Murillo Arteaga	4145	11	4/4/2025
Enzo Matias Flores Franco	470	1	16/3/2026
Erick Thiago Arteaga Escobar	300	1	5/1/2026
Ernesto Murkel Urzagaste Abel	390	1	11/3/2026
Ernesto Nuñez	1500	4	1/12/2025
Esteban Menacho Soto	11090	26	28/8/2023
Ethan Nicolas Arnez Calatayud	7200	17	2/9/2024
Ezequiel Romero Aguilera	870	4	3/8/2022
Ezequiel Saldias García	1000	3	2/12/2025
Fabricio Justiniano Herrera	5900	21	7/6/2023
Fary Arom Meneses Perez	4710	14	8/11/2023
Federico Vaca Vonborries	10990	23	25/4/2024
Felipe Mateo Gutiérrez Aireyu	1705	6	24/7/2025
Felipe Velarde Arteaga	470	1	18/3/2026
Fernando Aguilera Cronembold	14195	27	8/1/2024
Franco Alvarez Eguez	19150	37	1/3/2023
Franco Eduardo Rivas Azero	4700	14	13/2/2023
Franco Eduardo Vargas Cabrera	1400	4	3/12/2025
Franco Jauslin Duran	9883	22	9/1/2024
Franco Luis Cespedes Cespedes	570	1	24/3/2026
Franco Ocampo Velarde	2350	5	1/9/2025
Franco Tufiño Morales	28691	42	31/8/2022
Gabriel Casazola Saavedra	570	1	24/3/2026
Gabriel González	1800	2	5/2/2026
Gabriel Matias Cronenbold Murialdo	20770	39	19/10/2022
Gadiel Rivero Centella	2515	9	30/1/2025
Gian Franco Baigorria Alvis	1650	6	5/10/2023
Heber Jordi Menacho Hermosilla	6850	24	12/9/2022
Ignacio Cronenbold Murialdo	15580	36	16/1/2023
Iker Caso Castillo	700	2	1/12/2025
Iker Jhoset Ponce Arteaga	300	1	1/4/2026
Iker Michael Cuellar Montaño	2750	9	3/5/2025
Iker Uriel Cerezo Terceros	150	1	1/6/2025
Ilan Luis Guillen Montaño	10600	27	9/8/2023
Isaias David Leoni Villarroel	300	1	21/4/2026
Isaías Toro Pérez	550	2	13/3/2026
Jaime Moreno Sanchez	15180	32	2/6/2023
James Andersson Castro Gonzales	3420	13	24/4/2025
Javier Blanco Okubo	220	1	16/4/2026
Jese Sneijder Dorado Vaca	2115	8	21/2/2025
Jhael Oliver Aguirre Barrios	5087	9	21/3/2023
Joaquin Emiliano Tapia Terceros	13850	35	16/1/2023
Joaquin Nabil Hollweg	5270	18	11/6/2024
Joaquin Rojas Ulloa	590	2	15/1/2026
Joaquin Sanchez Gutierrez	3200	15	15/3/2023
Jorge Emiliano Cerruto Casazola	720	2	13/3/2026
Jorge Lucas Casazola Saavedra	720	1	11/3/2026
Jose Andres Serrudo Castro	420	1	21/4/2026
Jose Benjamin Fernandez Velasquez	1580	5	16/1/2023
Jose Carlo Aguilera Antezana	2800	9	24/4/2025
Jose Chris Ortiz Rifarachi	740	2	8/12/2025
Jose Dario Villena Sejas	11698	24	16/2/2024
Jose Ernesto Camacho Berdeja	24375	33	1/12/2022
Jose Geraldo Baigorria Alvis	8180	24	19/9/2023
Jose Ibrahim Senzano Calderon	3020	10	7/3/2025
Jose Manuel Guachalla Montero	1500	4	3/8/2022
José Maria Cardozo Gonzales	390	1	24/3/2026
Jose Maria Chavez Guiteras	10040	15	1/9/2022
José María Cuéllar Durán	1200	3	27/11/2025
José María Ortuño Becerra	21370	31	31/10/2022
Jose Miguel Guachalla Montero	1500	4	3/8/2022
Jose Miguel Sandoval Castro	13415	28	13/11/2023
Jose Ricardo Garcia Ayllon	300	1	15/12/2025
Joseph Gamaliel Castro Franco	7030	26	29/1/2024
Josue Vaca Gutierrez	350	1	5/2/2026
Juan Andrés Foianini Becerra	24150	40	7/10/2022
Juan Carlos Tapia Terceros	11465	35	16/1/2023
Juan Manuel Tapia Puerta	850	2	4/11/2025
Juan Matias Torrico Rueda	9700	19	24/7/2024
Juan Pablo Arteaga Carrizales	1910	4	27/1/2026
Leandro Dudu Toledo Aranibar	1200	4	9/1/2026
Leandro Torrico Torres	3250	12	23/4/2025
Leonardo Montenegro Villarroel	8790	27	1/7/2022
Leonel Heredia Chanevi	3900	7	21/3/2023
Leonel Serrudo Castro	350	1	21/4/2026
Lucas Baldiviezo Ferreira	19645	29	11/7/2022
Lucas Barrios Padilla	1270	4	5/12/2025
Lucas Facundo Velasco Roca	15515	33	5/12/2022
Lucas Hsieh Melgar	2370	10	17/6/2025
Lucas Jese Villegas Carrizales	400	2	11/8/2025
Lucas Rivero Gonzales	2050	7	23/5/2023
Lucas Sandoval Franco	16310	41	12/10/2022
Lucas Taborga Castro	1110	3	11/2/2026
Lucas Tellez Romero	24760	41	22/8/2022
Luciano Hernandez Laubreaux	520	1	16/3/2026
Luciano Mendoza AIvarez	12050	25	23/8/2023
Luem Sthepano Flores Vidal	4285	9	22/7/2024
Luis Adrian Ramirez Suarez	1420	2	6/3/2026
Luis Alberto Hoyos Moy	390	1	31/3/2026
Luis Antonio Parada Saucedo	6387	18	5/7/2023
Luis Enrique Cáceres Mendieta	1290	3	3/2/2026
Luis Federico Ferrufino	1750	4	9/7/2025
Luka Soljancic Banegas	6230	16	18/5/2023
Marcel Chandor Haab Román	2670	6	10/11/2025
Marco Antoriano Aireyu	3550	9	11/7/2025
María Victoria Cáceres Mendieta	1050	3	3/2/2026
Mariano Osinaga Ortiz	14115	38	7/12/2022
Mariano Tufiño Morales	520	1	30/3/2026
Mario Edwin Paredes Rojas	290	2	24/3/2026
Mario Fernando Pereira Saavedra	150	1	14/1/2026
Martin Alberto Prudencio Siles	8135	17	4/7/2022
Martin Alonso Castro Figueroa	12310	29	21/8/2023
Mateo Cabrera Becerra	3660	15	18/12/2023
Mateo Cognigni Atela	15380	37	7/7/2022
Mateo Dante Galeano Pereira	3710	11	28/7/2022
Mateo Moreno Sánchez	440	2	12/7/2023
Mateo Pereyra Barrenechea	470	1	10/4/2026
Mateo Rodriguez Vaca	4310	20	15/12/2022
Mati Abdel Melendrez Chambi	15280	36	16/2/2023
Matias Lazarte Severiche	4670	11	24/6/2025
Matías Leandro Corrales Zabala	470	1	1/4/2026
Matias Morales Suarez Arana	11630	25	15/1/2024
Matias Padilla Acebo	7575	15	4/2/2025
Maximiliano Deleva Soto	3250	7	3/10/2025
Miguel Elias Castedo	220	1	18/12/2025
Milan Hernan Antezana	1540	4	8/1/2026
Milan Nicolas Rios Hurtado	350	2	29/1/2026
Murilo Amorim Costa Beber	26345	40	3/8/2022
Nahuel Parada Comba	21970	41	1/9/2022
Nicolas Antelo Nieme	17635	33	13/7/2022
Nicolas Añez Michel	450	1	7/1/2026
Nicolas Barrios Dipp	26015	46	21/7/2022
Nicolas Josias Ballesteros Matienzo	400	1	24/3/2026
Nicolas Martin Vaca Soria	15950	31	30/6/2023
Nicolas Perez Higueras	2070	6	2/7/2025
Nicolas Sandoval Chavez	7440	17	16/12/2024
Nicolas Vargas Ribera	17920	36	6/12/2022
Nikolas Ortuño Quiroga	2910	14	26/9/2024
Noah Kessler Malgor	10210	25	5/9/2022
Octavio Ribera Terrazas	2740	6	19/8/2025
Oliver Saucedo Rodas	930	6	12/2/2025
Omar Santiago Ruiz Ortiz	14155	27	5/2/2024
Oscar Felipe Justiniano Roca	9330	21	24/2/2023
Paulo Farid Rea	820	2	13/2/2026
Pedro Daniel Otterburg Román	19190	38	7/7/2022
Pedro Tellez Romero	9980	31	22/8/2022
Pietro Costabeber Ereña	23630	43	20/7/2022
Rafael Antoriano Aireyu	1570	5	4/9/2025
Rafael Ardaya Pereira	220	1	23/3/2026
Rafael Unzueta Dominguez	4400	11	3/2/2025
Rafael Velarde Balcazar	600	2	3/3/2026
Raysa Senzano Romero	870	2	12/3/2026
Renzo Ribera Torrico	19855	36	10/8/2022
Roger Ribera Bowles	11840	25	18/7/2023
Ronny Raldes Vargas	4790	15	6/1/2025
Said Daniel Leaños Cuellar	12850	35	2/5/2023
Said Dante Fernández Machicado	5650	12	13/12/2024
Said Zeballos Alvarez	8660	26	21/7/2022
Samir Rodriguez Mayser	1470	4	27/1/2026
Samuel Campbell Gutiérrez	370	2	25/3/2026
Samuel de Jesús Mamani Jaimes	950	3	13/1/2026
Samuel Felipe Burillo Gonzales	13980	34	6/2/2023
Samuel Moreno Sanchez	2920	8	2/6/2023
Santiago Alvarez Estevez	15855	37	12/4/2023
Santiago Ballester Calvimontes	1870	3	2/2/2026
Santiago Da Silva Goytia	1340	3	10/2/2026
Santiago Hinojosa Arze	7170	12	11/1/2023
Santiago Jhossiel Rivero Cespedes	3080	12	20/4/2023
Santiago Quina Vargas	390	1	12/3/2026
Santiago Torrez Cid	5740	10	3/6/2025
Santiago Yamil Suarez Plaza	2800	10	29/5/2025
Saúl Gutierrez Bolivar	860	3	2/12/2025
Sebastian Avila Romero	22455	46	30/6/2022
Sebastián Barbery Añez	1610	3	13/2/2026
Sebastian Crespo Perez	4970	11	17/3/2025
Sebastian Franco Suarez	9970	24	5/1/2024
Sebastian Lopez Villarroel	9480	24	1/7/2022
Sebastian Pacheco Gutierrez	2010	8	21/5/2025
Sebastián Peña Rojas	300	1	1/4/2026
Sebastian Piñera Ortiz	11575	31	18/7/2022
Sebastian Salazar Suarez	3100	6	3/9/2025
Selim David Seleme Quinteros	6365	11	3/6/2025
Sergio Alejandro Moreno Villena	1880	6	1/2/2023
Snaider Romero Aguilar	300	1	12/4/2024
Tadeo Zenteno Agramont	10520	23	15/2/2024
Tarek Acouri Fraija	13260	26	9/10/2023
Thiago Coimbra	1100	5	18/9/2025
Thiago Justiniano Sulzer	15710	32	17/7/2023
Thiago Mariscal Bruno	4290	15	31/3/2023
Thiago Mauricio Saavedra Riguera	200	1	3/2/2026
Thiago Vladimir Alvarez Mercado	2265	10	21/2/2024
Thiara Rivero Contreras	525	4	4/6/2025
Vladimir Herrera Torrez	3900	9	14/4/2025
Xavi Lionel Antezana Toledo	10650	25	29/2/2024
Xiomara Senzano Romero	1210	2	10/3/2026
Yusser Villarroel Novillo	3285	8	4/1/2023
Zabdiel David Giron Contreras	970	3	11/2/2026`;

const lines = rawData.trim().split('\n');
const sqlUpdates = lines.map(line => {
  const parts = line.split('\t').map(p => p.trim());
  if (parts.length < 4) return null;

  const fullName = parts[0];
  const ingresos = parts[1].replace(',', '.');
  const meses = parts[2];
  const fechaStr = parts[3];

  // Convert D/M/YYYY to YYYY-MM-DD
  const dateParts = fechaStr.split('/');
  const year = dateParts[2];
  const month = dateParts[1].padStart(2, '0');
  const day = dateParts[0].padStart(2, '0');
  const isoDate = `${year}-${month}-${day}`;

  // We need to match nombres and apellidos
  // This is tricky because some have 2 names and 2 last names.
  // We'll use a CASE statement or multiple updates with subqueries.
  // A better way is to use a temporary table or just generate many UPDATE statements matching by full name.
  
  return `UPDATE alumnos 
SET ingresos_iniciales = ${ingresos}, 
    meses_permanencia_inicial = ${meses}, 
    fecha_inicio = '${isoDate}'
WHERE (nombres || ' ' || apellidos) ILIKE '${fullName}';`;
}).filter(Boolean);

fs.writeFileSync('update_alumnos.sql', sqlUpdates.join('\n'));
console.log(`Generated ${sqlUpdates.length} update statements.`);

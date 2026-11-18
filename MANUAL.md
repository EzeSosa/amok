# amok — manual de uso

Editor mínimo para trabajar al lado de un agente: abrís una carpeta, buscás, leés, editás y revisás lo que cambió.
Colorea Java, Python, TypeScript/JavaScript, shell, SQL, Dockerfile y Jenkinsfile; no tiene extensiones. Todo se maneja con el teclado.

> Tip: **Ctrl+Shift+P** muestra todos los comandos con su atajo. Si te olvidás de algo, empezá por ahí.
> La lista completa de atajos está en [ATAJOS.md](ATAJOS.md). La instalación (Windows y Linux) está en el [README](README.md).

---

## 1. Abrir

Desde la carpeta del proyecto:

```
amok .
```

En Linux también aparece en el menú de aplicaciones. Sin el comando instalado: `npm start -- /ruta/al/proyecto`
desde la carpeta de amok.

- Si no le pasás una carpeta, abre la última que usaste y restaura las pestañas que tenías abiertas.
- **Ctrl+O** abre otra carpeta.
- Podés tener varias ventanas, una por proyecto.

## 2. Moverse por el proyecto

| Atajo | Qué hace |
|---|---|
| **Ctrl+P** | Busca un archivo por nombre (fuzzy: `umath` encuentra `utils/math.js`) |
| `archivo:42` en Ctrl+P | Abre el archivo en la línea 42 |
| **Ctrl+B** | Muestra u oculta el árbol de archivos |
| **Ctrl+Shift+E** | Te lleva al árbol con el archivo actual seleccionado |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Pestaña siguiente / anterior |
| **Ctrl+W** | Cierra la pestaña (click del medio también) |

Con Ctrl+P vacío ves primero los archivos que abriste hace poco.

**En el árbol:** ↑ ↓ para moverte, → expande, ← colapsa o sube a la carpeta padre, **Enter** abre, **Esc** vuelve al editor.
El borde derecho del árbol se arrastra para cambiar el ancho.

## 3. Buscar

| Atajo | Qué hace |
|---|---|
| **Ctrl+Shift+F** o **Ctrl+Alt+H** | Busca dentro de todos los archivos |
| ↑ ↓ y **Enter** | Recorrer los resultados y abrir uno |
| **Alt+C** / **Alt+W** / **Alt+R** | Distinguir mayúsculas / palabra completa / regex |
| **F8** / **Shift+F8** | Resultado siguiente / anterior sin volver a abrir el panel |
| **Ctrl+F** | Busca en el archivo actual (Enter siguiente, Shift+Enter anterior) |
| **Ctrl+G** | Ir a una línea |

- Si tenés texto seleccionado al apretar Ctrl+Shift+F o Ctrl+F, se busca eso.
- La búsqueda respeta el `.gitignore`. Fuera de un repo se saltea `node_modules`, `dist`, `build`, etc.

## 4. Editar

| Atajo | Qué hace |
|---|---|
| **Ctrl+S** / **Ctrl+Shift+S** | Guardar / guardar todo |
| **Ctrl+N** | Archivo nuevo: escribís la ruta (`docs/notas.md`) y crea las carpetas que falten |
| **Tab** / **Shift+Tab** | Indentar / desindentar (también con varias líneas seleccionadas) |
| **Alt+Supr** | Borrar la línea |
| **Shift+Alt+↓** / **↑** | Duplicar la línea abajo / arriba (también **Ctrl+Alt+↓** / **↑**, como Eclipse) |
| **Alt+↓** / **↑** | Mover la línea abajo / arriba |
| **Ctrl+/** | Comentar / descomentar |
| **Ctrl+Shift+R** | Recargar del disco descartando tus cambios |

- Los atajos de línea actúan sobre todas las líneas que toque la selección, y Ctrl+Z los deshace de a uno.
  Hay más (línea nueva sin cortar la actual, seleccionar línea) en [ATAJOS.md](ATAJOS.md).

- Las pestañas con cambios sin guardar muestran un **●**.
- La indentación se detecta en cada archivo (tabs, 2 o 4 espacios).
- Los finales de línea (CRLF/LF) y el BOM se conservan tal como estaban.
- Al cerrar con cambios sin guardar, te pregunta antes.

## 5. Colores, temas y zoom

- Se colorean `.java`, `.py`, `.ts`, `.sh` y `.sql`, también `.js`/`.tsx`/`.bash`/`.groovy`/`.gradle`. La barra de abajo muestra el lenguaje.
- Los Dockerfile y Jenkinsfile se reconocen por el nombre, con o sin sufijo: `Dockerfile`, `Dockerfile.dev`,
  `Containerfile`, `Jenkinsfile`, `Jenkinsfile-deploy`, `Jenkinsfile.prod`…
- También se colorean los bloques de código de Markdown (` ```java `, ` ```python `, ` ```ts `, ` ```bash `, ` ```sql `, ` ```dockerfile `, ` ```groovy `) y las líneas de los diffs.
- Los archivos de más de 500 KB se muestran sin color para que el editor siga rápido.
- **Ctrl+Shift+P → "Cambiar tema"**: Oscuro, Darcula (estilo JetBrains) o Claro.
- **Ctrl +** / **Ctrl −** / **Ctrl 0**, o **Ctrl + rueda del mouse**: zoom de toda la interfaz (editor, árbol, Markdown, diffs).
- Si querés achicar o agrandar solo el texto del editor: Ctrl+Shift+P → "Fuente del editor".

El tema y el zoom se recuerdan entre sesiones.

## 6. Markdown

Los `.md` abren formateados. **Ctrl+E** alterna entre lectura y edición.

- En modo lectura, los links a otros `.md` del proyecto se abren en el editor y los links web en el navegador.
- Si el agente modifica el `.md` mientras lo estás leyendo, se actualiza solo.

## 7. Revisar lo que hizo el agente (git)

| Atajo | Qué hace |
|---|---|
| **Ctrl+Shift+D** | Pestaña **Cambios**: diff de todo el repo contra HEAD |
| **Ctrl+Shift+G** | Lista de archivos cambiados; Enter abre su diff |
| **Ctrl+D** | Diff del archivo actual (Ctrl+D de nuevo vuelve a editar) |
| **F7** / **Shift+F7** (o `n` / `p`) | Siguiente / anterior bloque de cambios |
| Doble click en una línea | Abre el archivo para editar en esa línea |

- Los diffs son de solo lectura y comparan **HEAD contra lo que está en disco**. Lo que no guardaste no aparece.
- Los archivos nuevos sin trackear aparecen enteros como agregados.
- Click en el nombre de un archivo lo abre. Click en el resto del encabezado lo colapsa. Los diffs muy largos (lockfiles) arrancan colapsados.
- En el árbol y en la lista de archivos cambiados, cada archivo lleva su estado:
  **M** modificado · **U** nuevo sin trackear · **A** agregado · **D** borrado · **R** renombrado · **C** conflicto.
  Las carpetas con cambios adentro llevan un **•**.

## 8. Cuando el agente toca archivos

amok vigila la carpeta todo el tiempo:

- **Archivo abierto sin cambios tuyos:** se recarga solo y te avisa en la barra de abajo.
- **Archivo abierto con cambios tuyos sin guardar:** la pestaña se pone amarilla y vos decidís.
  **Ctrl+S** guarda tu versión encima de la del agente; **Ctrl+Shift+R** descarta lo tuyo y carga la del agente.
- **Archivo borrado:** te avisa; si guardás con Ctrl+S, lo vuelve a crear.
- **Archivos nuevos, commits, stage:** el árbol, los estados y los diffs se actualizan solos en alrededor de un segundo.

## 9. Terminal

La terminal es **una pestaña más**, a pantalla completa, como un archivo. Arranca en la carpeta del proyecto:
PowerShell en Windows, tu shell (`$SHELL`) en Linux. Es una terminal de verdad: corren ahí el agente, `git add -p`, `vim`, etc.

| Atajo | Qué hace |
|---|---|
| **Ctrl+J** | Desde un archivo: va a la terminal (si no hay, abre una). Desde la terminal: vuelve al último archivo |
| **Ctrl+Shift+J** | Terminal nueva (pueden ser varias: el agente en una, un servidor en otra) |
| **Ctrl+Tab** | Pasa por las pestañas, terminales incluidas |

- Ctrl+J es para ir y venir entre lo que estás leyendo (una spec en `.md`, por ejemplo) y el agente.
  Moverte a otra pestaña no corta nada: lo que corre en la terminal sigue.
- Con el foco en la terminal, casi todas las teclas van al shell (Ctrl+C, Ctrl+D, Ctrl+R, Ctrl+W, Esc…).
  Siguen andando **Ctrl+J**, **Ctrl+P**, los atajos con **Ctrl+Shift**, Ctrl+Tab, el zoom, F8 y F12.
- **Ctrl+C** con texto seleccionado copia; sin selección interrumpe, como siempre. **Ctrl+V** pega.
- `exit` cierra la pestaña. Cerrarla con la × también corta el shell (pregunta antes).
  Ctrl+Shift+P → "Terminal: reiniciar" abre un shell nuevo en la misma pestaña.
- Las pestañas de terminal se recuerdan con el resto: al volver a abrir el proyecto están ahí, con un shell nuevo.
- Al cerrar amok se cierran los shells y todo lo que hayas lanzado desde ahí.
- Las terminales también aparecen arriba del árbol de archivos: click para ir a una, click del medio para cerrarla,
  "+ Terminal nueva" para abrir otra. Al pasar el mouse ves el título que puso el programa (el agente, la carpeta…).
- Usa el tema y el tamaño de letra del editor. Otro shell: variable de entorno `AMOK_SHELL`
  (por ejemplo `pwsh.exe` o `/usr/bin/zsh`).

## 10. Flujo típico

1. `amok .` en la carpeta del proyecto y **Ctrl+J** para abrir una terminal y arrancar el agente.
2. Le pedís algo al agente.
3. **Ctrl+Shift+D** para ver todo lo que cambió y recorrer los cambios con **F7**.
4. Ves algo para corregir: doble click en la línea, editás y **Ctrl+S**.
5. ¿Dónde se usa tal función? **Ctrl+Shift+F**, y **F8** para ir pasando por los resultados.
6. El agente escribió un plan en `.md`: **Ctrl+P**, `plan`, y lo leés formateado.

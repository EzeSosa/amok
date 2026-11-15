# liviano — atajos de teclado

Referencia completa. En Linux los atajos son los mismos. **Ctrl+Shift+P** abre la lista de comandos por si te olvidás de alguno.

## Generales

| Atajo | Acción |
|---|---|
| **Ctrl+Shift+P** | Lista de todos los comandos |
| **Ctrl+O** | Abrir carpeta |
| **Esc** | Cerrar el panel o la barra que esté abierta |
| **Ctrl +** / **Ctrl −** / **Ctrl 0** | Zoom de toda la interfaz: acercar / alejar / 100% |
| **Ctrl + rueda del mouse** | Zoom |
| **F12** | DevTools (para depurar el editor) |

## Archivos y pestañas

| Atajo | Acción |
|---|---|
| **Ctrl+P** | Buscar archivo por nombre (fuzzy) |
| `archivo:42` en Ctrl+P | Abrir el archivo en la línea 42 |
| **Ctrl+N** | Archivo nuevo (crea las carpetas que falten) |
| **Ctrl+S** | Guardar |
| **Ctrl+Shift+S** | Guardar todo |
| **Ctrl+Shift+R** | Recargar del disco descartando tus cambios |
| **Ctrl+W** | Cerrar pestaña |
| Click del medio en la pestaña | Cerrar pestaña |
| **Ctrl+Tab** / **Ctrl+Shift+Tab** | Pestaña siguiente / anterior |
| **Ctrl+PageDown** / **Ctrl+PageUp** | Pestaña siguiente / anterior |

## Árbol de archivos

| Atajo | Acción |
|---|---|
| **Ctrl+B** | Mostrar / ocultar el árbol |
| **Ctrl+Shift+E** | Ir al árbol, con el archivo actual seleccionado |
| **↑** / **↓** | Moverse |
| **PageUp** / **PageDown** / **Home** / **End** | Moverse de a saltos / al principio / al final |
| **→** | Expandir carpeta (si ya está abierta, baja al primer hijo) |
| **←** | Colapsar carpeta (si ya está cerrada, sube a la carpeta padre) |
| **Enter** | Abrir archivo / expandir o colapsar carpeta |
| **Ctrl+N** con foco en el árbol | Archivo nuevo dentro de la carpeta seleccionada |
| **Esc** | Volver al editor |

## Buscar

| Atajo | Acción |
|---|---|
| **Ctrl+Shift+F** o **Ctrl+Alt+H** | Buscar en todos los archivos (usa la selección actual si hay) |
| **↑** / **↓**, **PageUp** / **PageDown** | Recorrer resultados |
| **Enter** | Abrir el resultado seleccionado |
| **Alt+C** | Distinguir mayúsculas |
| **Alt+W** | Palabra completa |
| **Alt+R** | Expresión regular |
| **F8** / **Shift+F8** | Resultado siguiente / anterior (con el panel cerrado) |
| **Ctrl+F** | Buscar en el archivo actual |
| **Enter** / **Shift+Enter** en Ctrl+F | Coincidencia siguiente / anterior |
| **Ctrl+G** | Ir a una línea |

## Edición

| Atajo | Acción |
|---|---|
| **Tab** | Indentar (con varias líneas seleccionadas, indenta el bloque) |
| **Shift+Tab** | Desindentar la línea o el bloque |
| **Enter** | Nueva línea manteniendo la indentación |
| **Ctrl+Enter** / **Ctrl+Shift+Enter** | Nueva línea abajo / arriba, sin cortar la actual |
| **Alt+Supr** | Borrar la línea |
| **Shift+Alt+↓** / **Shift+Alt+↑** | Duplicar la línea abajo / arriba |
| **Ctrl+Alt+↓** / **Ctrl+Alt+↑** | Lo mismo, como en Eclipse (algunos drivers de video de Windows usan este atajo para rotar la pantalla) |
| **Alt+↓** / **Alt+↑** | Mover la línea abajo / arriba |
| **Ctrl+L** | Seleccionar la línea; repetido, suma la siguiente |
| **Ctrl+/** (en teclado español, **Ctrl+Shift+7**; o **Ctrl** + **/** del teclado numérico) | Comentar / descomentar. `//` en Java y TS/JS, `#` en Python y shell (también YAML, TOML, Go, C, etc.) |
| **Ctrl+Z** | Deshacer |
| **Ctrl+Y** (Windows) / **Ctrl+Shift+Z** | Rehacer |

Los atajos de línea actúan sobre todas las líneas que toque la selección y se deshacen con un solo Ctrl+Z.

## Markdown

| Atajo | Acción |
|---|---|
| **Ctrl+E** | Alternar lectura ⇄ edición |
| Click en un link | Abre otro `.md` del proyecto en el editor, o una URL en el navegador |

## Git y diffs

| Atajo | Acción |
|---|---|
| **Ctrl+D** | Diff del archivo actual contra HEAD (Ctrl+D de nuevo vuelve a editar) |
| **Ctrl+Shift+D** | Pestaña "Cambios": diff de todo el repo |
| **Ctrl+Shift+G** | Lista de archivos cambiados; Enter abre su diff |
| **F7** / **Shift+F7** | Bloque de cambios siguiente / anterior |
| **n** / **p** (o **j** / **k**) | Bloque de cambios siguiente / anterior |
| Doble click en una línea | Abrir el archivo para editar en esa línea |
| Click en el nombre del archivo | Abrir el archivo |
| Click en el resto del encabezado | Colapsar / expandir ese archivo |

## Terminal

| Atajo | Acción |
|---|---|
| **Ctrl+J** | Abrir la terminal / enfocarla / ocultarla (si ya tiene el foco) |
| **Ctrl+C** con texto seleccionado · **Ctrl+Shift+C** | Copiar |
| **Ctrl+V** · **Ctrl+Shift+V** | Pegar |
| `exit` | Cierra el shell y el panel |

Con el foco en la terminal, las demás teclas van al shell. Siguen siendo de liviano: Ctrl+P, los atajos con Ctrl+Shift
(salvo C y V), Ctrl+Alt+H, Ctrl+Tab, Ctrl+PageUp/PageDown, el zoom, F8 y F12.

## Paletas (Ctrl+P, Ctrl+Shift+P, Ctrl+Shift+G, Ctrl+G, Ctrl+N)

| Atajo | Acción |
|---|---|
| **↑** / **↓**, **PageUp** / **PageDown** | Moverse por la lista |
| **Enter** | Elegir |
| **Esc** o click afuera | Cerrar |

## Solo desde Ctrl+Shift+P (sin atajo)

- Cambiar tema (Oscuro, Darcula, Claro)
- Fuente del editor: agrandar / achicar / tamaño por defecto
- Cerrar todas las pestañas
- Reindexar archivos
- Terminal: reiniciar

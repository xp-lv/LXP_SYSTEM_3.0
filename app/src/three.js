/* three.js r128 由 index.html 以 UMD 方式预先加载到 window.THREE。
   本模块把它桥接为 ES 导出，其余模块统一 `import THREE from './three.js'`。
   将来迁移 Vite/npm 时，只需把这里改为 `import * as THREE from 'three'`。 */
const THREE=window.THREE;
export default THREE;

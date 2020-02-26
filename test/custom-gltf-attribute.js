/*
 * Example: converting an SVF from Model Derivative service into glTF with a custom mesh attribute.
 * Usage:
 *     export FORGE_CLIENT_ID=<your client id>
 *     export FORGE_CLIENT_SECRET=<your client secret>
 *     node custom-gltf-attribute.js <your model urn> <path to output folder>
 */

const path = require('path');
const { ModelDerivativeClient, ManifestHelper } = require('forge-server-utils');
const { SvfReader, GltfWriter } = require('..');

/*
 * Customized glTF writer, outputting meshes with an additional _CUSTOM_INDEX
 * mesh attribute (UNSIGNED_BYTE, vec4) encoding a 32-bit object ID.
 */
class CustomGltfWriter extends GltfWriter {
    constructor(options) {
        super(options);
        this._currentDbId = -1;
    }

    createNode(fragment /* IMF.IObjectNode */, imf /* IMF.IScene */, outputUvs /* boolean */) /* gltf.Node */ {
        this._currentDbId = fragment.dbid;
        return super.createNode(fragment, imf, outputUvs);
    }

    createMeshGeometry(geometry /* IMF.IMeshGeometry */, imf /* IMF.IScene */, outputUvs /* boolean */) /* gltf.Mesh */ {
        let mesh = super.createMeshGeometry(geometry, imf, outputUvs);
        let prim = mesh.primitives[0];

        if (prim) {
            // Output custom attr buffer
            const vertexCount = geometry.getVertices().length / 3;
            const customBuffer = Buffer.alloc(vertexCount * 4);
            for (let i = 0; i < customBuffer.length; i += 4) {
                customBuffer[i] = (this._currentDbId >> 24) & 0xff;
                customBuffer[i + 1] = (this._currentDbId >> 16) & 0xff;
                customBuffer[i + 2] = (this._currentDbId >> 8) & 0xff;
                customBuffer[i + 3] = this._currentDbId & 0xff;
            }
            const customBufferView = this.createBufferView(customBuffer);
            const customBufferViewID = this.addBufferView(customBufferView);
            const customAccessor = this.createAccessor(customBufferViewID, 5121 /* UNSIGNED_BYTE */, customBufferView.byteLength / 4, 'VEC4');
            const customAccessorID = this.addAccessor(customAccessor);
            prim.attributes['_CUSTOM_INDEX'] = customAccessorID;
        }

        return mesh;
    }

    computeMeshHash(mesh /* gltf.Mesh */) /* string */ {
        return mesh.primitives.map(p => {
            return `${p.mode || ''}/${p.material || ''}/${p.indices}`
                + `/${p.attributes['POSITION'] || ''}/${p.attributes['NORMAL'] || ''}/${p.attributes['TEXCOORD_0'] || ''}`
                + `/${p.attributes['COLOR_0'] || ''}/${p.attributes['_CUSTOM_INDEX'] || ''}`;
        }).join('/');
    }
}

const { FORGE_CLIENT_ID, FORGE_CLIENT_SECRET } = process.env;

async function run (urn, outputDir) {
    const DefaultOptions = {
        deduplicate: false,
        skipUnusedUvs: false,
        center: true,
        log: console.log
    };

    try {
        const auth = { client_id: FORGE_CLIENT_ID, client_secret: FORGE_CLIENT_SECRET };
        const modelDerivativeClient = new ModelDerivativeClient(auth);
        const helper = new ManifestHelper(await modelDerivativeClient.getManifest(urn));
        const derivatives = helper.search({ type: 'resource', role: 'graphics' });
        const writer = new CustomGltfWriter(Object.assign({}, DefaultOptions));
        for (const derivative of derivatives.filter(d => d.mime === 'application/autodesk-svf')) {
            const reader = await SvfReader.FromDerivativeService(urn, derivative.guid, auth);
            const scene = await reader.read({ log: console.log });
            await writer.write(scene, path.join(outputDir, derivative.guid));
        }
    } catch(err) {
        console.error(err);
        process.exit(1);
    }
}

run(process.argv[2], process.argv[3]);

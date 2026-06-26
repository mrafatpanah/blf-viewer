// CDD (CANDela Studio Diagnostic Database) XML file parser.
// Pure TypeScript, no runtime dependencies.

export interface CddService {
  name: string;
  service: string;
  type: 'req' | 'pos' | 'neg';
  sid: number;
  param: number | null;
  paramType: 'sub' | 'did' | 'none';
}

export interface CddDatabase {
  fileName: string;
  requestCanId: number | null;
  responseCanId: number | null;
  services: Map<string, CddService>; // key: "10 01", "22 F1 8C"
}

export function parseCddFile(text: string, fileName: string): CddDatabase {
  const db: CddDatabase = {
    fileName,
    requestCanId: null,
    responseCanId: null,
    services: new Map()
  };

  // 1. Extract UNSDEFs for Request/Response CAN IDs
  const reqIdDefMatch = text.match(/<UNSDEF\s+id='([^']+)'[^>]*>\s*<NAME>\s*<TUV[^>]*>Request CAN-ID<\/TUV>/i);
  const resIdDefMatch = text.match(/<UNSDEF\s+id='([^']+)'[^>]*>\s*<NAME>\s*<TUV[^>]*>Response CAN-ID<\/TUV>/i);

  const reqAttrId = reqIdDefMatch ? reqIdDefMatch[1] : null;
  const resAttrId = resIdDefMatch ? resIdDefMatch[1] : null;

  if (reqAttrId) {
    const unsMatch = text.match(new RegExp(`<UNS\\s+[^>]*attrref='${reqAttrId}'[^>]*>`, 'i'));
    if (unsMatch) {
      const vMatch = unsMatch[0].match(/v='(\d+)'/i);
      if (vMatch) { db.requestCanId = parseInt(vMatch[1], 10); }
    }
  }
  if (resAttrId) {
    const unsMatch = text.match(new RegExp(`<UNS\\s+[^>]*attrref='${resAttrId}'[^>]*>`, 'i'));
    if (unsMatch) {
      const vMatch = unsMatch[0].match(/v='(\d+)'/i);
      if (vMatch) { db.responseCanId = parseInt(vMatch[1], 10); }
    }
  }

  // 2. Parse Protocol Services
  const protocolServices: { [id: string]: { id: string; sidHex: string; name: string; reqSid: number; posSid: number | null; paramType: 'sub' | 'did' | 'none' } } = {};
  const protoServiceRe = /<PROTOCOLSERVICE\s+id='([^']+)'[^>]*>([\s\S]*?)<\/PROTOCOLSERVICE>/gi;
  let match;
  while ((match = protoServiceRe.exec(text)) !== null) {
    const id = match[1];
    const body = match[2];
    const nameMatch = body.match(/<NAME>\s*<TUV[^>]*>\(\$(\w+)\)\s*([^<]+)<\/TUV>/i);
    if (nameMatch) {
      const sidHex = nameMatch[1];
      const name = nameMatch[2].trim();
      const reqSidMatch = body.match(/<REQ[\s\S]*?<CONSTCOMP[^>]*?spec='sid'[^>]*?v='(\d+)'/i);
      const posSidMatch = body.match(/<POS[\s\S]*?<CONSTCOMP[^>]*?spec='sid'[^>]*?v='(\d+)'/i);
      
      const hasDid = /spec='id'/i.test(body);
      const staticCompMatch = body.match(/<STATICCOMP[^>]*?spec='([^']+)'/gi);
      let paramType: 'sub' | 'did' | 'none' = 'none';
      if (hasDid) {
        paramType = 'did';
      } else if (staticCompMatch) {
        for (const m of staticCompMatch) {
          const specMatch = m.match(/spec='([^']+)'/i);
          if (specMatch) {
            const spec = specMatch[1];
            if (spec !== 'sid' && spec !== 'id') {
              paramType = 'sub';
              break;
            }
          }
        }
      }

      protocolServices[id] = {
        id,
        sidHex,
        name,
        reqSid: reqSidMatch ? parseInt(reqSidMatch[1], 10) : parseInt(sidHex, 16),
        posSid: posSidMatch ? parseInt(posSidMatch[1], 10) : null,
        paramType
      };
    }
  }

  // 3. Parse DCLSRVTMPL
  const dclSrvTemplates: { [id: string]: string } = {};
  const dclSrvTmplRe = /<DCLSRVTMPL\s+id='([^']+)'[^>]*tmplref='([^']+)'[^>]*>/gi;
  while ((match = dclSrvTmplRe.exec(text)) !== null) {
    dclSrvTemplates[match[1]] = match[2];
  }

  // 4. Parse DIAGINSTs and map inner services to request/response SIDs
  const diagInstRe = /<DIAGINST\s+id='([^']+)'[^>]*>([\s\S]*?)<\/DIAGINST>/gi;
  while ((match = diagInstRe.exec(text)) !== null) {
    const instBody = match[2];
    
    // Extract static values from the DIAGINST (first value represents DID or Sub-function type)
    const staticValues: number[] = [];
    const staticValRe = /<STATICVALUE\s+[^>]*v='(\d+)'/gi;
    let svMatch;
    while ((svMatch = staticValRe.exec(instBody)) !== null) {
      staticValues.push(parseInt(svMatch[1], 10));
    }

    // Find inner SERVICEs
    const serviceRe = /<SERVICE\s+id='([^']+)'[^>]*tmplref='([^']+)'[^>]*>([\s\S]*?)<\/SERVICE>/gi;
    let sMatch;
    while ((sMatch = serviceRe.exec(instBody)) !== null) {
      const tmplref = sMatch[2];
      const sBody = sMatch[3];

      const sNameMatch = sBody.match(/<SHORTCUTNAME>\s*<TUV[^>]*>([^<]+)<\/TUV>/i) || sBody.match(/<NAME>\s*<TUV[^>]*>([^<]+)<\/TUV>/i);
      const sName = sNameMatch ? sNameMatch[1].trim() : '';

      const protoServiceId = dclSrvTemplates[tmplref];
      const protoService = protocolServices[protoServiceId];

      if (protoService) {
        let paramVal: number | null = null;
        if (protoService.paramType === 'sub' || protoService.paramType === 'did') {
          if (staticValues.length > 0) {
            paramVal = staticValues[0];
          }
        }

        const reqSid = protoService.reqSid;
        const posSid = protoService.posSid;

        let paramBytes: number[] = [];
        if (paramVal !== null) {
          if (protoService.paramType === 'sub') {
            paramBytes = [paramVal];
          } else if (protoService.paramType === 'did') {
            paramBytes = [(paramVal >> 8) & 0xFF, paramVal & 0xFF];
          }
        }

        const reqBytes = [reqSid, ...paramBytes];
        const reqKey = reqBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

        db.services.set(reqKey, {
          name: sName + '::req',
          service: sName,
          type: 'req',
          sid: reqSid,
          param: paramVal,
          paramType: protoService.paramType
        });

        if (posSid !== null) {
          const posBytes = [posSid, ...paramBytes];
          const posKey = posBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

          db.services.set(posKey, {
            name: sName + '::pos',
            service: sName,
            type: 'pos',
            sid: posSid,
            param: paramVal,
            paramType: protoService.paramType
          });
        }
      }
    }
  }

  return db;
}

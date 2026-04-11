exports.getScriptPage = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    res.render('scrip', { 
        title: 'Thư Viện Scrip', 
        page: 'Scrip', 
        currentUser: activeUser,
        script_result: null,
        activeTab: '3g900' // Tab mặc định
    });
};

exports.generateScript = (req, res) => {
    const activeUser = res.locals.currentUser || req.session.user || req.user;
    const tech = req.body.tech || '3g900';
    
    // HÀM HỖ TRỢ: Khắc phục khác biệt giữa Python và Express.
    // Tự động nhận diện trường mảng kể cả khi HTML có đuôi [] hay không.
    const getList = (key) => {
        let val = req.body[key] !== undefined ? req.body[key] : req.body[key + '[]'];
        if (val === undefined) return [];
        return Array.isArray(val) ? val : [val];
    };
    
    const rns = getList('rn');
    const srns = getList('srn');
    const hsns = getList('hsn');
    const hpns = getList('hpn');
    const rcns = getList('rcn');
    const secids = getList('sectorid');
    const rxnums = getList('rxnum');
    const txnums = getList('txnum');

    let lines = [];

    // Bẫy lỗi nếu mảng trống
    if (rns.length === 0) {
        return res.render('scrip', { 
            title: 'Thư Viện Scrip', 
            page: 'Scrip', 
            currentUser: activeUser,
            script_result: "Lỗi: Không nhận được dữ liệu đầu vào. Vui lòng thêm ít nhất 1 RRU.",
            activeTab: tech
        });
    }

    for (let i = 0; i < rns.length; i++) {
        // 1. Lệnh ADD RRUCHAIN
        lines.push(`ADD RRUCHAIN: RCN=${rcns[i]}, TT=CHAIN, BM=COLD, AT=LOCALPORT, HSRN=0, HSN=${hsns[i]}, HPN=${hpns[i]}, CR=AUTO, USERDEFRATENEGOSW=OFF;`);
        
        // Xác định Mode
        let rs_mode = tech.includes("900") ? "GU" : tech.includes("2100") ? "UO" : "LO";
        if (tech === '4g') rs_mode = "LO";
        
        // 2. Lệnh ADD RRU
        lines.push(`ADD RRU: CN=0, SRN=${srns[i]}, SN=0, TP=TRUNK, RCN=${rcns[i]}, PS=0, RT=MRRU, RS=${rs_mode}, RN="${rns[i]}", RXNUM=${rxnums[i]}, TXNUM=${txnums[i]}, MNTMODE=NORMAL, RFDCPWROFFALMDETECTSW=OFF, RFTXSIGNDETECTSW=OFF;`);
        
        // Chuỗi Antenna
        let ant_num = parseInt(rxnums[i]) || 0;
        let ant_str = `ANT1CN=0, ANT1SRN=${srns[i]}, ANT1SN=0, ANT1N=R0A`;
        if (ant_num >= 2) ant_str += `, ANT2CN=0, ANT2SRN=${srns[i]}, ANT2SN=0, ANT2N=R0B`;
        if (ant_num >= 4) ant_str += `, ANT3CN=0, ANT3SRN=${srns[i]}, ANT3SN=0, ANT3N=R0C, ANT4CN=0, ANT4SRN=${srns[i]}, ANT4SN=0, ANT4N=R0D`;
        
        // 3. Lệnh ADD SECTOR
        lines.push(`ADD SECTOR: SECTORID=${secids[i]}, ANTNUM=${ant_num}, ${ant_str}, CREATESECTOREQM=FALSE;`);
        
        // Chuỗi Type
        let ant_type_str = "ANTTYPE1=RXTX_MODE";
        if (ant_num >= 2) ant_type_str += ", ANTTYPE2=RXTX_MODE";
        if (ant_num >= 4) ant_type_str += ", ANTTYPE3=RXTX_MODE, ANTTYPE4=RXTX_MODE";
        
        // Sửa lại SRN = 0 cho SECTOREQM
        let sectoreqm_ant_str = ant_str
            .replace(new RegExp(`ANT1SRN=${srns[i]}`, 'g'), 'ANT1SRN=0')
            .replace(new RegExp(`ANT2SRN=${srns[i]}`, 'g'), 'ANT2SRN=0')
            .replace(new RegExp(`ANT3SRN=${srns[i]}`, 'g'), 'ANT3SRN=0')
            .replace(new RegExp(`ANT4SRN=${srns[i]}`, 'g'), 'ANT4SRN=0');
            
        // 4. Lệnh ADD SECTOREQM
        lines.push(`ADD SECTOREQM: SECTOREQMID=${secids[i]}, SECTORID=${secids[i]}, ANTCFGMODE=ANTENNAPORT, ANTNUM=${ant_num}, ${sectoreqm_ant_str}, ${ant_type_str};`);
        lines.push(""); // Dòng trống ngăn cách
    }

    const script_result = lines.join("\n");

    res.render('scrip', { 
        title: 'Thư Viện Scrip', 
        page: 'Scrip', 
        currentUser: activeUser,
        script_result: script_result,
        activeTab: tech 
    });
};

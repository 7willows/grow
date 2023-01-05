import { grow } from '../../mod.ts';
import { IAccess } from './contract.ts';

grow({
    Access: {
        contract: [IAccess],
        config: {
            url: "OK"
        }
    },
    // Manager: {
    //     contract: [IManager]
    // },
});


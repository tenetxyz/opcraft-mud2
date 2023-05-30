// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.8.0;
import { System } from "@latticexyz/world/src/System.sol";
import { IWorld } from "../codegen/world/IWorld.sol";
import { defineBlocks } from "../prototypes/Blocks.sol";

contract InitSystem is System {
    IWorld private world;
    constructor() {
        world = IWorld(_world());
    }

    function init() public {
        defineBlocks(world);
    }
}
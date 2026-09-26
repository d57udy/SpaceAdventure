import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { Entity } = await import('../../js/entity.js');

beforeEach(() => {
    Entity.worldWidth = 0;
    Entity.worldHeight = 0;
});

test('constructor sets defaults', () => {
    const e = new Entity(1, 2);
    assert.equal(e.x, 1);
    assert.equal(e.y, 2);
    assert.equal(e.radius, 10);
    assert.equal(e.velX, 0);
    assert.equal(e.velY, 0);
    assert.equal(e.isAlive, true);
});

test('update and updateInfinite integrate velocity without wrapping', () => {
    const e = new Entity(0, 0);
    e.velX = 100; e.velY = -50;
    e.update(0.5, 10, 10);
    assert.deepEqual([e.x, e.y], [50, -25]);
    e.updateInfinite(1);
    assert.deepEqual([e.x, e.y], [150, -75]);
});

test('collidesWith: overlapping vs separated (no wrapping)', () => {
    const a = new Entity(0, 0, 10);
    const b = new Entity(15, 0, 10);
    const c = new Entity(20, 0, 10); // exactly touching -> strict < means no collision
    assert.equal(a.collidesWith(b), true);
    assert.equal(b.collidesWith(a), true);
    assert.equal(a.collidesWith(c), false);
});

test('collidesWith: objects on opposite sides of the seam do NOT collide without wrapping', () => {
    const a = new Entity(2, 500, 10);
    const b = new Entity(998, 500, 10);
    assert.equal(a.collidesWith(b), false);
});

test('collidesWith: objects on opposite sides of the X seam collide when wrapping is set', () => {
    Entity.worldWidth = 1000;
    Entity.worldHeight = 1000;
    const a = new Entity(2, 500, 10);
    const b = new Entity(998, 500, 10);
    assert.equal(a.collidesWith(b), true);
    assert.equal(b.collidesWith(a), true);
});

test('collidesWith: objects across the Y seam and the corner collide when wrapping is set', () => {
    Entity.worldWidth = 1000;
    Entity.worldHeight = 800;
    assert.equal(new Entity(500, 1, 5).collidesWith(new Entity(500, 797, 5)), true);
    assert.equal(new Entity(1, 1, 5).collidesWith(new Entity(998, 798, 5)), true);
    // far apart even with wrapping
    assert.equal(new Entity(0, 0, 5).collidesWith(new Entity(500, 400, 5)), false);
});

test('dead entities never collide', () => {
    Entity.worldWidth = 1000;
    Entity.worldHeight = 1000;
    const a = new Entity(0, 0, 10);
    const b = new Entity(0, 0, 10);
    b.isAlive = false;
    assert.equal(a.collidesWith(b), false);
    assert.equal(b.collidesWith(a), false);
    a.isAlive = false;
    b.isAlive = true;
    assert.equal(a.collidesWith(b), false);
});

test('destroy() is idempotent: true first, false afterwards', () => {
    const e = new Entity(0, 0);
    assert.equal(e.destroy(), true);
    assert.equal(e.isAlive, false);
    assert.equal(e.destroy(), false);
    assert.equal(e.isAlive, false);
});

test('Entity.wrappedDelta without wrapping returns raw delta', () => {
    assert.deepEqual(Entity.wrappedDelta(10, 20, 990, 5), { dx: 980, dy: -15 });
});

test('Entity.wrappedDelta with wrapping returns shortest delta from -> to', () => {
    Entity.worldWidth = 1000;
    Entity.worldHeight = 600;
    assert.deepEqual(Entity.wrappedDelta(10, 20, 990, 5), { dx: -20, dy: -15 });
    assert.deepEqual(Entity.wrappedDelta(990, 590, 10, 10), { dx: 20, dy: 20 });
});

test('draw does nothing for dead entities and strokes for alive ones', () => {
    const calls = [];
    const ctx = new Proxy({}, {
        get: (_, k) => (...args) => calls.push(k),
        set: () => true,
    });
    const e = new Entity(0, 0);
    e.draw(ctx);
    assert.ok(calls.includes('stroke'));
    calls.length = 0;
    e.isAlive = false;
    e.draw(ctx);
    assert.equal(calls.length, 0);
});
